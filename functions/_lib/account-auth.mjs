import { createRemoteJWKSet, jwtVerify } from "jose";
import { scryptAsync } from "@noble/hashes/scrypt";
import { createEmailProvider, isEmailDeliveryConfigured } from "./email-provider.mjs";

export const ACCOUNT_SESSION_COOKIE = "__Host-trg_session";
export const ACCOUNT_CSRF_COOKIE = "trg_account_csrf";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMITS = Object.freeze({
  google: 20,
  login: 10,
  password_reset: 6,
  register: 6,
  verification: 8
});
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function handleAccountAuthRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth\/?/, "").replace(/\/+$/g, "");
  if (request.method !== "POST") {
    return json({ error: { code: "method_not_allowed", message: "Use POST for account actions." } }, 405);
  }

  if (!validateSameOriginRequest(request)) {
    return json({ error: { code: "csrf_rejected", message: "This account request could not be verified." } }, 403);
  }

  switch (path) {
    case "register":
      return registerAccount(request, env, options);
    case "login":
      return loginAccount(request, env, options);
    case "google":
      return loginWithGoogle(request, env, options);
    case "logout":
      return logoutAccount(request, env);
    case "verify-email":
      return verifyEmail(request, env, options);
    case "resend-verification":
      return resendVerification(request, env, options);
    case "request-password-reset":
      return requestPasswordReset(request, env, options);
    case "reset-password":
      return resetPassword(request, env, options);
    default:
      return json({ error: { code: "not_found", message: "That account action does not exist." } }, 404);
  }
}

export async function handleAccountMeRequest(request, env) {
  if (request.method !== "GET") {
    return json({ error: { code: "method_not_allowed", message: "Use GET for account lookup." } }, 405);
  }
  const session = await getSessionFromRequest(request, env);
  if (!session.valid) {
    return json({
      authenticated: false,
      googleClientId: publicGoogleClientId(env),
      user: null
    });
  }
  return json({
    authenticated: true,
    csrfToken: session.csrfToken,
    googleClientId: publicGoogleClientId(env),
    user: publicUser(session.user)
  }, 200, {
    "set-cookie": buildSessionCookieHeaders(session.rawSessionToken, session.csrfToken)
  });
}

export async function registerAccount(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const passwordConfirmation = String(body.passwordConfirmation || body.confirmPassword || "");
  const passwordError = validatePassword(password);
  const now = nowIso(options);

  if (!isEmail(email)) {
    return json({ error: { code: "invalid_registration", message: "Enter a valid email address and password." } }, 400);
  }
  if (password !== passwordConfirmation || passwordError) {
    return json({ error: { code: "invalid_password", message: passwordError || "Password confirmation must match." } }, 400);
  }
  if (!(await allowRateLimit(db, request, "register", email, options))) {
    return json({ error: { code: "rate_limited", message: "Too many account attempts. Please wait and try again." } }, 429);
  }

  const existing = await getUserByEmail(db, email);
  if (existing) {
    return json({ error: { code: "duplicate_email", message: "An account with that email already exists." } }, 409);
  }

  const user = { id: randomId(), email, now };
  const passwordHash = await hashPassword(password, options.passwordHashOptions);
  await db.batch([
    db.prepare(`
      INSERT INTO users (id, email_normalized, email_verified, status, role, created_at, updated_at)
      VALUES (?, ?, 0, 'active', 'user', ?, ?)
    `).bind(user.id, email, now, now),
    db.prepare(`
      INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind(user.id, passwordHash, now, now)
  ]);
  const loaded = await getUserById(db, user.id);
  const verification = await createEmailVerificationToken(db, user.id, options);
  await sendVerificationEmail(request, env, loaded, verification.token, options);
  const session = await createSession(db, loaded, options);
  return json({
    ok: true,
    message: "Account created. Check your email to verify the address.",
    user: publicUser(loaded)
  }, 201, {
    "set-cookie": buildSessionCookieHeaders(session.sessionToken, session.csrfToken)
  });
}

export async function loginAccount(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!(await allowRateLimit(db, request, "login", email || "unknown", options))) {
    return json({ error: { code: "rate_limited", message: "Too many sign-in attempts. Please wait and try again." } }, 429);
  }

  const generic = () => json({ error: { code: "invalid_login", message: "The email or password did not work." } }, 401);
  const user = isEmail(email) ? await getUserByEmail(db, email) : null;
  if (!user || user.status !== "active") {
    return generic();
  }
  const credential = await db.prepare("SELECT password_hash FROM password_credentials WHERE user_id = ?").bind(user.id).first();
  if (!credential || !(await verifyPassword(password, credential.password_hash))) {
    return generic();
  }
  const session = await createSession(db, user, options);
  return json({ ok: true, user: publicUser(user) }, 200, {
    "set-cookie": buildSessionCookieHeaders(session.sessionToken, session.csrfToken)
  });
}

export async function loginWithGoogle(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const csrfToken = String(body.g_csrf_token || request.headers.get("x-gis-csrf-token") || "");
  const csrfCookie = readCookie(request, "g_csrf_token");
  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
    return json({ error: { code: "google_csrf_rejected", message: "Google sign-in could not be verified." } }, 403);
  }
  if (!(await allowRateLimit(db, request, "google", "gis", options))) {
    return json({ error: { code: "rate_limited", message: "Too many Google sign-in attempts. Please wait and try again." } }, 429);
  }

  const verified = await verifyGoogleCredential(String(body.credential || ""), env, options.google);
  if (!verified.valid) {
    return json({ error: { code: verified.code, message: "Google sign-in could not be verified." } }, 401);
  }
  if (!verified.emailVerified) {
    return json({ error: { code: "google_email_unverified", message: "Google has not verified this email address." } }, 403);
  }

  const now = nowIso(options);
  let identity = await db.prepare(`
    SELECT i.user_id, u.*
    FROM user_identities i JOIN users u ON u.id = i.user_id
    WHERE i.provider = 'google' AND i.provider_subject = ?
  `).bind(verified.subject).first();

  let user = identity || null;
  if (!user) {
    const existing = await getUserByEmail(db, verified.email);
    if (existing?.email_verified === 1) {
      user = existing;
    } else if (!existing) {
      const userId = randomId();
      await db.prepare(`
        INSERT INTO users (id, email_normalized, email_verified, email_verified_at, status, role, created_at, updated_at)
        VALUES (?, ?, 1, ?, 'active', 'user', ?, ?)
      `).bind(userId, verified.email, now, now, now).run();
      user = await getUserById(db, userId);
    } else {
      user = existing;
    }

    await db.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email_normalized, created_at, updated_at)
      VALUES (?, ?, 'google', ?, ?, ?, ?)
    `).bind(randomId(), user.id, verified.subject, verified.email, now, now).run();
  }

  const session = await createSession(db, user, options);
  return json({ ok: true, user: publicUser(user) }, 200, {
    "set-cookie": buildSessionCookieHeaders(session.sessionToken, session.csrfToken)
  });
}

export async function logoutAccount(request, env) {
  const db = requireDb(env);
  const token = readCookie(request, ACCOUNT_SESSION_COOKIE);
  if (token) {
    await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), await hashToken(token)).run();
  }
  return json({ ok: true }, 200, {
    "set-cookie": [
      clearCookie(ACCOUNT_SESSION_COOKIE, { httpOnly: true, sameSite: "Lax" }),
      clearCookie(ACCOUNT_CSRF_COOKIE, { sameSite: "Lax" })
    ]
  });
}

export async function verifyEmail(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const token = String(body.token || "");
  if (!(await allowRateLimit(db, request, "verification", "verify", options))) {
    return json({ error: { code: "rate_limited", message: "Too many verification attempts. Please wait and try again." } }, 429);
  }
  const row = await db.prepare(`
    SELECT t.id, t.user_id, t.expires_at, t.used_at
    FROM email_verification_tokens t
    WHERE t.token_hash = ?
  `).bind(await hashToken(token)).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= nowMs(options)) {
    return json({ error: { code: "verification_invalid", message: "This verification link is invalid or expired." } }, 410);
  }
  const now = nowIso(options);
  await db.batch([
    db.prepare("UPDATE email_verification_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, row.id),
    db.prepare("UPDATE users SET email_verified = 1, email_verified_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.user_id)
  ]);
  return json({ ok: true, message: "Email verified." });
}

export async function resendVerification(request, env, options = {}) {
  const db = requireDb(env);
  const session = await getSessionFromRequest(request, env, options);
  if (!session.valid) {
    return json({ error: { code: "not_authenticated", message: "Sign in before requesting verification." } }, 401);
  }
  const csrf = await validateSessionCsrf(request, session);
  if (!csrf.valid) {
    return json({ error: { code: "csrf_rejected", message: "This account request could not be verified." } }, 403);
  }
  if (session.user.email_verified === 1) {
    return json({ ok: true, message: "This email is already verified." });
  }
  const verification = await createEmailVerificationToken(db, session.user.id, options);
  await sendVerificationEmail(request, env, session.user, verification.token, options);
  return json({ ok: true, message: "Check your email for a new verification link." });
}

export async function requestPasswordReset(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!(await allowRateLimit(db, request, "password_reset", email || "unknown", options))) {
    return json({ ok: true, message: "If that account exists, reset instructions will be sent." });
  }
  const user = isEmail(email) ? await getUserByEmail(db, email) : null;
  if (user?.status === "active") {
    const reset = await createPasswordResetToken(db, user.id, options);
    await sendPasswordResetEmail(request, env, user, reset.token, options);
  }
  return json({ ok: true, message: "If that account exists, reset instructions will be sent." });
}

export async function resetPassword(request, env, options = {}) {
  const db = requireDb(env);
  const body = await readJson(request);
  const token = String(body.token || "");
  const password = String(body.password || "");
  const passwordConfirmation = String(body.passwordConfirmation || body.confirmPassword || "");
  const passwordError = validatePassword(password);
  if (password !== passwordConfirmation || passwordError) {
    return json({ error: { code: "invalid_password", message: passwordError || "Password confirmation must match." } }, 400);
  }
  const row = await db.prepare(`
    SELECT id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = ?
  `).bind(await hashToken(token)).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= nowMs(options)) {
    return json({ error: { code: "reset_invalid", message: "This reset link is invalid or expired." } }, 410);
  }
  const now = nowIso(options);
  const passwordHash = await hashPassword(password, options.passwordHashOptions);
  await db.batch([
    db.prepare(`
      INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at
    `).bind(row.user_id, passwordHash, now, now),
    db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, row.id),
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, row.user_id)
  ]);
  return json({ ok: true, message: "Password reset complete. Sign in with the new password." });
}

export async function verifyGoogleCredential(credential, env = {}, options = {}) {
  const clientId = String(env.GOOGLE_CLIENT_ID || options.clientId || "").trim();
  if (!clientId) {
    return { valid: false, code: "google_not_configured" };
  }
  try {
    const verifier = options.jwtVerify || jwtVerify;
    const keyLike = options.keyLike || GOOGLE_JWKS;
    const { payload } = await verifier(credential, keyLike, {
      audience: clientId,
      issuer: [...GOOGLE_ISSUERS]
    });
    const subject = String(payload.sub || "");
    const email = normalizeEmail(payload.email);
    if (!subject) return { valid: false, code: "google_subject_missing" };
    if (!isEmail(email)) return { valid: false, code: "google_email_missing" };
    return {
      valid: true,
      email,
      emailVerified: payload.email_verified === true,
      subject
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/\b(aud|audience)\b/i.test(message)) return { valid: false, code: "google_wrong_audience" };
    if (/\b(exp|expired)\b/i.test(message)) return { valid: false, code: "google_token_expired" };
    return { valid: false, code: "google_signature_invalid" };
  }
}

export async function hashPassword(password, options = {}) {
  const salt = options.salt || randomBytes(16);
  const N = options.N || 16384;
  const r = options.r || 8;
  const p = options.p || 1;
  const dkLen = options.dkLen || 32;
  const hash = await scryptAsync(String(password || ""), salt, { N, dkLen, p, r });
  return `scrypt$N=${N},r=${r},p=${p},dk=${dkLen}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed.valid) return false;
  const actual = await scryptAsync(String(password || ""), parsed.salt, {
    N: parsed.N,
    dkLen: parsed.dkLen,
    p: parsed.p,
    r: parsed.r
  });
  return constantTimeEqual(actual, parsed.hash);
}

export function parsePasswordHash(storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return { valid: false };
  const params = Object.fromEntries(parts[1].split(",").map((part) => part.split("=")));
  const N = Number(params.N);
  const r = Number(params.r);
  const p = Number(params.p);
  const dkLen = Number(params.dk);
  if (![N, r, p, dkLen].every((value) => Number.isInteger(value) && value > 0)) return { valid: false };
  try {
    return { valid: true, N, dkLen, p, r, salt: fromBase64Url(parts[2]), hash: fromBase64Url(parts[3]) };
  } catch {
    return { valid: false };
  }
}

export function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/.test(value)) return "Use at least one lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Use at least one uppercase letter.";
  if (!/[0-9]/.test(value)) return "Use at least one number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Use at least one symbol.";
  return "";
}

export async function getSessionFromRequest(request, env, options = {}) {
  const db = requireDb(env);
  const rawSessionToken = readCookie(request, ACCOUNT_SESSION_COOKIE);
  if (!rawSessionToken) return { valid: false, reason: "missing" };
  const tokenHash = await hashToken(rawSessionToken);
  const row = await db.prepare(`
    SELECT s.*, u.id AS user_id, u.email_normalized, u.email_verified, u.email_verified_at, u.status, u.role, u.created_at AS user_created_at, u.updated_at AS user_updated_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).bind(tokenHash).first();
  if (!row || row.revoked_at || row.status !== "active" || Date.parse(row.expires_at) <= nowMs(options)) {
    return { valid: false, reason: "invalid" };
  }
  const csrfToken = readCookie(request, ACCOUNT_CSRF_COOKIE);
  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(nowIso(options), row.id).run();
  return {
    valid: true,
    csrfToken,
    rawSessionToken,
    session: row,
    user: {
      id: row.user_id,
      email_normalized: row.email_normalized,
      email_verified: row.email_verified,
      email_verified_at: row.email_verified_at,
      status: row.status,
      role: row.role,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at
    }
  };
}

async function validateSessionCsrf(request, session) {
  const submitted = String(request.headers.get("x-csrf-token") || "");
  if (!submitted || !session.csrfToken || submitted !== session.csrfToken) return { valid: false };
  const hash = await hashToken(submitted);
  return { valid: hash === session.session.csrf_token_hash };
}

async function createSession(db, user, options = {}) {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const now = nowIso(options);
  const expires = new Date(nowMs(options) + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(randomId(), user.id, await hashToken(sessionToken), await hashToken(csrfToken), now, expires, now).run();
  return { csrfToken, sessionToken };
}

async function createEmailVerificationToken(db, userId, options = {}) {
  const token = randomToken();
  const now = nowIso(options);
  await db.prepare(`
    INSERT INTO email_verification_tokens (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(randomId(), userId, await hashToken(token), now, new Date(nowMs(options) + VERIFY_TTL_MS).toISOString()).run();
  return { token };
}

async function createPasswordResetToken(db, userId, options = {}) {
  const token = randomToken();
  const now = nowIso(options);
  await db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(randomId(), userId, await hashToken(token), now, new Date(nowMs(options) + RESET_TTL_MS).toISOString()).run();
  return { token };
}

async function sendVerificationEmail(request, env, user, token, options = {}) {
  const url = new URL("/account.html", request.url);
  url.searchParams.set("verify", token);
  return sendAccountEmail(env, {
    html: `<p>Verify your Tobacco Road Games account email:</p><p><a href="${escapeHtml(url.toString())}">Verify my email</a></p><p>This link expires in 24 hours.</p>`,
    subject: "Verify your Tobacco Road Games account",
    text: `Verify your Tobacco Road Games account: ${url.toString()}`,
    to: user.email_normalized
  }, `account-verify-${user.id}-${token}`, options);
}

async function sendPasswordResetEmail(request, env, user, token, options = {}) {
  const url = new URL("/account.html", request.url);
  url.searchParams.set("reset", token);
  return sendAccountEmail(env, {
    html: `<p>Reset your Tobacco Road Games account password:</p><p><a href="${escapeHtml(url.toString())}">Reset my password</a></p><p>This link expires in one hour.</p>`,
    subject: "Reset your Tobacco Road Games password",
    text: `Reset your Tobacco Road Games password: ${url.toString()}`,
    to: user.email_normalized
  }, `account-reset-${user.id}-${token}`, options);
}

async function sendAccountEmail(env, message, idempotencyKey, options = {}) {
  if (options.emailProvider) return options.emailProvider.send(message, { idempotencyKey });
  if (env.emailProvider) return env.emailProvider.send(message, { idempotencyKey });
  if (!isEmailDeliveryConfigured(env)) return { id: null, status: "not_configured" };
  return createEmailProvider(env).send(message, { idempotencyKey });
}

async function allowRateLimit(db, request, action, identity, options = {}) {
  if (options.disableRateLimit) return true;
  const limit = RATE_LIMITS[action] || 5;
  const key = await hashToken(`${action}|${request.headers.get("cf-connecting-ip") || "unknown"}|${identity}`);
  const now = nowMs(options);
  const nowText = new Date(now).toISOString();
  const current = await db.prepare("SELECT attempt_count, window_started_at FROM auth_rate_limits WHERE key_hash = ?").bind(key).first();
  if (!current || Date.parse(current.window_started_at) < now - RATE_LIMIT_WINDOW_MS) {
    await db.prepare(`
      INSERT INTO auth_rate_limits (key_hash, action, attempt_count, window_started_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(key_hash) DO UPDATE SET action = excluded.action, attempt_count = 1, window_started_at = excluded.window_started_at
    `).bind(key, action, nowText).run();
    return true;
  }
  if (Number(current.attempt_count) >= limit) return false;
  await db.prepare("UPDATE auth_rate_limits SET attempt_count = attempt_count + 1 WHERE key_hash = ?").bind(key).run();
  return true;
}

async function getUserByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email_normalized = ?").bind(email).first();
}

async function getUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

function publicUser(user) {
  return {
    email: user.email_normalized,
    emailVerified: Number(user.email_verified) === 1,
    id: user.id,
    role: user.role,
    status: user.status
  };
}

function publicGoogleClientId(env) {
  return String(env.GOOGLE_CLIENT_ID || "").trim();
}

function requireDb(env) {
  if (!env.TRG_ORDERS?.prepare) throw new Error("Account database is unavailable.");
  return env.TRG_ORDERS;
}

function validateSameOriginRequest(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function nowMs(options = {}) {
  return Number.isFinite(options.now) ? Number(options.now) : Date.now();
}

function nowIso(options = {}) {
  return new Date(nowMs(options)).toISOString();
}

function randomId() {
  return crypto.randomUUID();
}

function randomToken() {
  return toBase64Url(randomBytes(32));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildSessionCookieHeaders(sessionToken, csrfToken) {
  return [
    buildCookie(ACCOUNT_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
      sameSite: "Lax"
    }),
    buildCookie(ACCOUNT_CSRF_COOKIE, csrfToken, {
      maxAge: SESSION_TTL_SECONDS,
      sameSite: "Lax"
    })
  ];
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`, "Path=/"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function clearCookie(name, options = {}) {
  return buildCookie(name, "", { ...options, maxAge: 0 });
}

function readCookie(request, name) {
  const raw = String(request.headers.get("cookie") || "");
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json; charset=utf-8"
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(JSON.stringify(payload), { headers, status });
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
