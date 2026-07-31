const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "migrations", "007_shared_accounts.sql"), "utf8");
const ORIGIN = "https://tobaccoroadgames.com";
const TEST_OPTIONS = Object.freeze({
  disableRateLimit: true,
  now: Date.parse("2026-07-30T12:00:00.000Z"),
  passwordHashOptions: { N: 16, dkLen: 16, p: 1, r: 1 }
});

async function main() {
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  await testPasswordHashing(auth);
  await testRegistrationLoginSessionLogout(auth);
  await testEmailVerification(auth);
  await testPasswordReset(auth);
  await testGoogleLoginValidationAndLinking(auth);
  await testCsrfRejection(auth);
  await testTokenStorageAndRateLimits(auth);
  assertAccountPageAndRoutes();
  assertNoAuthBoundaryChanges();
  console.log("Shared account auth tests passed.");
}

async function testPasswordHashing(auth) {
  const hash = await auth.hashPassword("ValidPassphrase!23", TEST_OPTIONS.passwordHashOptions);
  assert.match(hash, /^scrypt\$/, "Native account passwords must use scrypt hashes.");
  assert.equal(await auth.verifyPassword("ValidPassphrase!23", hash), true);
  assert.equal(await auth.verifyPassword("wrong", hash), false);
  assert.doesNotMatch(hash, /ValidPassphrase/, "Password hashes must not contain plaintext.");
}

async function testRegistrationLoginSessionLogout(auth) {
  const env = createEnv();
  let response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: " Player@Example.COM ",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 201, "Successful registration should create an account.");
  let payload = await response.json();
  assert.equal(payload.user.email, "player@example.com");
  assert.equal(payload.user.emailVerified, false);
  assert.equal(env.emailProvider.messages.length, 1, "Registration should send verification email.");
  const cookies = getCookies(response);
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-trg_session=")), "Registration should create a session cookie.");
  assert.ok(cookies.every((cookie) => /Secure/.test(cookie)), "Account cookies should be Secure.");
  assert.ok(cookies.some((cookie) => /HttpOnly/.test(cookie)), "Session cookie should be HttpOnly.");
  assert.ok(cookies.some((cookie) => /SameSite=Lax/.test(cookie)), "Session cookies should use SameSite=Lax.");

  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "player@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 409, "Duplicate normalized email should be rejected.");

  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "weak@example.com",
    password: "short",
    passwordConfirmation: "short"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 400, "Invalid password should be rejected.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Valid native login should sign in.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "wrong"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 401, "Invalid native login should be rejected generically.");
  payload = await response.json();
  assert.equal(payload.error.code, "invalid_login");

  const loginCookies = getCookies(await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "ValidPassphrase!23"
  }), env, TEST_OPTIONS));
  const cookieHeader = cookieHeaderFrom(loginCookies);
  response = await auth.handleAccountMeRequest(new Request(`${ORIGIN}/api/account/me`, {
    headers: { cookie: cookieHeader }
  }), env);
  payload = await response.json();
  assert.equal(payload.authenticated, true, "Session lookup should load the signed-in user.");
  assert.equal(payload.user.email, "player@example.com");

  response = await auth.logoutAccount(jsonRequest("/api/auth/logout", {}, { cookie: cookieHeader }), env);
  assert.equal(response.status, 200, "Logout should succeed.");
  response = await auth.handleAccountMeRequest(new Request(`${ORIGIN}/api/account/me`, {
    headers: { cookie: cookieHeader }
  }), env);
  payload = await response.json();
  assert.equal(payload.authenticated, false, "Logout should revoke the session.");
}

async function testEmailVerification(auth) {
  const env = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "verify@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  const token = tokenFromLastEmail(env, "verify");
  let response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Valid verification token should verify email.");
  let user = await env.TRG_ORDERS.prepare("SELECT * FROM users WHERE email_normalized = ?").bind("verify@example.com").first();
  assert.equal(user.email_verified, 1);

  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token }), env, TEST_OPTIONS);
  assert.equal(response.status, 410, "Reused verification token should be rejected.");

  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "expired-verify@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  const expiredToken = tokenFromLastEmail(env, "verify");
  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: expiredToken }), env, {
    ...TEST_OPTIONS,
    now: TEST_OPTIONS.now + 25 * 60 * 60 * 1000
  });
  assert.equal(response.status, 410, "Expired verification token should be rejected.");
}

async function testPasswordReset(auth) {
  const env = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "reset@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  let response = await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "reset@example.com"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Password reset request should use generic success.");
  let payload = await response.json();
  assert.match(payload.message, /If that account exists/);
  const token = tokenFromLastEmail(env, "reset");
  response = await auth.resetPassword(jsonRequest("/api/auth/reset-password", {
    password: "DifferentPassphrase!24",
    passwordConfirmation: "DifferentPassphrase!24",
    token
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Valid reset token should update password.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "reset@example.com",
    password: "DifferentPassphrase!24"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "New password should work after reset.");

  response = await auth.resetPassword(jsonRequest("/api/auth/reset-password", {
    password: "ThirdPassphrase!25",
    passwordConfirmation: "ThirdPassphrase!25",
    token
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 410, "Reused reset token should be rejected.");

  await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "reset@example.com"
  }), env, TEST_OPTIONS);
  const expiredToken = tokenFromLastEmail(env, "reset");
  response = await auth.resetPassword(jsonRequest("/api/auth/reset-password", {
    password: "FourthPassphrase!26",
    passwordConfirmation: "FourthPassphrase!26",
    token: expiredToken
  }), env, { ...TEST_OPTIONS, now: TEST_OPTIONS.now + 2 * 60 * 60 * 1000 });
  assert.equal(response.status, 410, "Expired reset token should be rejected.");

  response = await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "missing@example.com"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Unknown reset email should not disclose existence.");
}

async function testGoogleLoginValidationAndLinking(auth) {
  const env = createEnv();
  const googleRequest = (credential = "valid") => jsonRequest("/api/auth/google", {
    credential,
    g_csrf_token: "gis-csrf"
  }, { cookie: "g_csrf_token=gis-csrf" });

  let response = await auth.loginWithGoogle(googleRequest(), env, {
    ...TEST_OPTIONS,
    google: {
      clientId: "google-client-id",
      jwtVerify: async (_credential, _key, verifyOptions) => {
        assert.equal(verifyOptions.audience, "google-client-id");
        return { payload: { email: "google@example.com", email_verified: true, sub: "google-sub-1" } };
      }
    }
  });
  assert.equal(response.status, 200, "Valid Google login should sign in.");
  assert.equal(await countRows(env.TRG_ORDERS, "users"), 1);
  assert.equal(await countRows(env.TRG_ORDERS, "user_identities"), 1);

  response = await auth.loginWithGoogle(googleRequest("bad-signature"), createEnv(), {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => { throw new Error("signature verification failed"); } }
  });
  assert.equal(response.status, 401, "Invalid Google signature should be rejected.");
  assert.equal((await response.json()).error.code, "google_signature_invalid");

  response = await auth.loginWithGoogle(googleRequest("wrong-audience"), createEnv(), {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => { throw new Error("unexpected aud claim value"); } }
  });
  assert.equal((await response.json()).error.code, "google_wrong_audience");

  response = await auth.loginWithGoogle(googleRequest("expired"), createEnv(), {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => { throw new Error("JWT expired"); } }
  });
  assert.equal((await response.json()).error.code, "google_token_expired");

  response = await auth.loginWithGoogle(googleRequest("unverified"), createEnv(), {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => ({ payload: { email: "unverified@example.com", email_verified: false, sub: "sub" } }) }
  });
  assert.equal(response.status, 403, "Unverified Google email should be rejected.");

  const linkedEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "link@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), linkedEnv, TEST_OPTIONS);
  await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: tokenFromLastEmail(linkedEnv, "verify") }), linkedEnv, TEST_OPTIONS);
  response = await auth.loginWithGoogle(jsonRequest("/api/auth/google", {
    credential: "link",
    g_csrf_token: "gis-csrf"
  }, { cookie: "g_csrf_token=gis-csrf" }), linkedEnv, {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => ({ payload: { email: "link@example.com", email_verified: true, sub: "google-linked-sub" } }) }
  });
  assert.equal(response.status, 200, "Verified matching Google email should link to existing account.");
  assert.equal(await countRows(linkedEnv.TRG_ORDERS, "users"), 1, "Identity linking must not duplicate a verified TRG account.");
  const identity = await linkedEnv.TRG_ORDERS.prepare("SELECT * FROM user_identities").first();
  assert.equal(identity.provider_subject, "google-linked-sub");
}

async function testCsrfRejection(auth) {
  const env = createEnv();
  let response = await auth.handleAccountAuthRequest(new Request(`${ORIGIN}/api/auth/register`, {
    body: JSON.stringify({
      email: "csrf@example.com",
      password: "ValidPassphrase!23",
      passwordConfirmation: "ValidPassphrase!23"
    }),
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    method: "POST"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 403, "Cross-origin account mutation should be rejected.");

  response = await auth.loginWithGoogle(jsonRequest("/api/auth/google", {
    credential: "valid",
    g_csrf_token: "one"
  }, { cookie: "g_csrf_token=two" }), env, {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => ({ payload: { email: "csrf@example.com", email_verified: true, sub: "sub" } }) }
  });
  assert.equal(response.status, 403, "Google GIS CSRF mismatch should be rejected.");
}

async function testTokenStorageAndRateLimits(auth) {
  const env = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "stored-token@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  const verificationToken = tokenFromLastEmail(env, "verify");
  const verificationRow = await env.TRG_ORDERS.prepare("SELECT token_hash FROM email_verification_tokens").first();
  assert.notEqual(verificationRow.token_hash, verificationToken, "Verification tokens must be stored only as hashes.");
  assert.equal(verificationRow.token_hash, await auth.hashToken(verificationToken));

  await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "stored-token@example.com"
  }), env, TEST_OPTIONS);
  const resetToken = tokenFromLastEmail(env, "reset");
  const resetRow = await env.TRG_ORDERS.prepare("SELECT token_hash FROM password_reset_tokens").first();
  assert.notEqual(resetRow.token_hash, resetToken, "Password reset tokens must be stored only as hashes.");
  assert.equal(resetRow.token_hash, await auth.hashToken(resetToken));

  const limitedEnv = createEnv();
  for (let index = 0; index < 6; index += 1) {
    await auth.registerAccount(jsonRequest("/api/auth/register", {
      email: "limited@example.com",
      password: "ValidPassphrase!23",
      passwordConfirmation: "ValidPassphrase!23"
    }), limitedEnv, { ...TEST_OPTIONS, disableRateLimit: false });
  }
  const response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "limited@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), limitedEnv, { ...TEST_OPTIONS, disableRateLimit: false });
  assert.equal(response.status, 429, "Repeated registration attempts should be throttled.");
}

function createEnv() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  return {
    GOOGLE_CLIENT_ID: "google-client-id",
    RESEND_API_KEY: "re_test",
    RESEND_REPLY_TO: "reply@example.com",
    TRG_ORDERS: d1(raw),
    emailProvider: {
      messages: [],
      async send(message, options) {
        this.messages.push({ message, options });
        return { id: `email-${this.messages.length}`, status: "accepted" };
      }
    }
  };
}

function d1(raw) {
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      return prepared(raw.prepare(sql));
    }
  };
}

function prepared(statement, values = []) {
  return {
    all: async () => ({ results: statement.all(...values) }),
    bind: (...nextValues) => prepared(statement, nextValues),
    first: async () => statement.get(...values) || null,
    run: async () => {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
  };
}

function jsonRequest(pathname, body, headers = {}) {
  return new Request(`${ORIGIN}${pathname}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...headers
    },
    method: "POST"
  });
}

function getCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const header = response.headers.get("set-cookie") || "";
  return header ? header.split(/,\s*(?=[^;,]+=)/) : [];
}

function cookieHeaderFrom(cookies) {
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function tokenFromLastEmail(env, kind) {
  const email = env.emailProvider.messages.at(-1)?.message?.text || "";
  const url = email.match(/https:\/\/[^\s]+/)?.[0] || "";
  const parsed = new URL(url);
  return parsed.searchParams.get(kind === "reset" ? "reset" : "verify");
}

async function countRows(db, table) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
  return Number(row.count || 0);
}

function assertNoAuthBoundaryChanges() {
  for (const relative of [
    "functions/_lib/stripe-checkout.mjs",
    "functions/_lib/download-authorization.mjs",
    "functions/_lib/office-access.mjs",
    "functions/_lib/owner-auth.mjs"
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /account-auth|password_credentials|user_identities/, `${relative} should not depend on public account auth.`);
  }
}

function assertAccountPageAndRoutes() {
  const accountPage = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
  assert.match(accountPage, /Continue with Google/, "Account page should offer Google sign-in.");
  assert.match(accountPage, /Create a TRG account/, "Account page should offer native registration.");
  assert.match(accountPage, /Sign in with a TRG account/, "Account page should offer native sign-in.");
  assert.match(accountPage, /Forgot password/, "Account page should offer password reset.");
  assert.match(accountPage, /Sign Out/i, "Account page should offer sign-out.");
  assert.doesNotMatch(accountPage, /profile photo|avatar|display name/i, "Account page must not expose Google profile photo or name.");

  const accountScript = fs.readFileSync(path.join(ROOT, "assets", "js", "account.js"), "utf8");
  assert.match(accountScript, /\/api\/auth\/google/, "Account script should submit Google credentials to the account API.");
  assert.match(accountScript, /\/api\/account\/me/, "Account script should load account state from the account API.");
  assert.doesNotMatch(accountScript, /rewrite|autofix/i, "Account UI must not add rewriting-style behavior.");

  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/auth/*"), "Cloudflare routes should include account auth functions.");
  assert.ok(routes.include.includes("/api/account/me"), "Cloudflare routes should include account state lookup.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
