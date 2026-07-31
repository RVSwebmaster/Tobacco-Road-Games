const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = [
  "007_shared_accounts.sql",
  "008_token_claim_markers.sql"
].map((file) => fs.readFileSync(path.join(ROOT, "migrations", file), "utf8")).join("\n");
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
  await testTokenReplayRaces(auth);
  await testTokenClaimRollback(auth);
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

async function testTokenReplayRaces(auth) {
  const verifyEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "race-verify@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), verifyEnv, TEST_OPTIONS);
  const verifyToken = tokenFromLastEmail(verifyEnv, "verify");
  const verifyResponses = await Promise.all([
    auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: verifyToken }), verifyEnv, TEST_OPTIONS),
    auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: verifyToken }), verifyEnv, TEST_OPTIONS)
  ]);
  assert.equal(verifyResponses.filter((response) => response.status === 200).length, 1, "Only one overlapping email verification should succeed.");
  assert.equal(verifyResponses.filter((response) => response.status === 410).length, 1, "The race-losing email verification should receive the safe invalid response.");
  const verifiedUser = await verifyEnv.TRG_ORDERS.prepare("SELECT email_verified FROM users WHERE email_normalized = ?").bind("race-verify@example.com").first();
  assert.equal(verifiedUser.email_verified, 1, "The user should become verified once.");
  const verificationTokenRow = await verifyEnv.TRG_ORDERS.prepare("SELECT COUNT(*) AS count FROM email_verification_tokens WHERE used_at IS NOT NULL").first();
  assert.equal(Number(verificationTokenRow.count), 1, "Exactly one verification token row should be consumed.");

  const resetEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "race-reset@example.com",
    password: "OriginalPassphrase!23",
    passwordConfirmation: "OriginalPassphrase!23"
  }), resetEnv, TEST_OPTIONS);
  const loginCookies = getCookies(await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "race-reset@example.com",
    password: "OriginalPassphrase!23"
  }), resetEnv, TEST_OPTIONS));
  const sessionsBeforeReset = await countRows(resetEnv.TRG_ORDERS, "sessions");
  await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "race-reset@example.com"
  }), resetEnv, TEST_OPTIONS);
  const resetToken = tokenFromLastEmail(resetEnv, "reset");
  const resetAttempts = [
    { password: "WinnerPassphrase!24", response: null },
    { password: "LoserPassphrase!25", response: null }
  ];
  await Promise.all(resetAttempts.map(async (attempt) => {
    attempt.response = await auth.resetPassword(jsonRequest("/api/auth/reset-password", {
      password: attempt.password,
      passwordConfirmation: attempt.password,
      token: resetToken
    }), resetEnv, TEST_OPTIONS);
  }));
  const successfulAttempts = resetAttempts.filter((attempt) => attempt.response.status === 200);
  const losingAttempts = resetAttempts.filter((attempt) => attempt.response.status === 410);
  assert.equal(successfulAttempts.length, 1, "Only one overlapping password reset should succeed.");
  assert.equal(losingAttempts.length, 1, "The race-losing password reset should receive the safe invalid response.");
  const finalCredential = await resetEnv.TRG_ORDERS.prepare(`
    SELECT c.password_hash
    FROM password_credentials c JOIN users u ON u.id = c.user_id
    WHERE u.email_normalized = ?
  `).bind("race-reset@example.com").first();
  assert.equal(await auth.verifyPassword(successfulAttempts[0].password, finalCredential.password_hash), true, "The final password should match only the successful reset request.");
  assert.equal(await auth.verifyPassword(losingAttempts[0].password, finalCredential.password_hash), false, "The losing reset request must not change credentials.");
  assert.equal(await countRows(resetEnv.TRG_ORDERS, "sessions"), sessionsBeforeReset, "Password reset should revoke existing sessions without creating new ones.");
  const activeSessions = await resetEnv.TRG_ORDERS.prepare("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL").first();
  assert.equal(Number(activeSessions.count), 0, "Existing sessions should be revoked only after the successful reset.");
  const oldSessionLookup = await auth.handleAccountMeRequest(new Request(`${ORIGIN}/api/account/me`, {
    headers: { cookie: cookieHeaderFrom(loginCookies) }
  }), resetEnv);
  assert.equal((await oldSessionLookup.json()).authenticated, false, "Existing session cookies should stop working after the successful reset.");
}

async function testTokenClaimRollback(auth) {
  const verifyEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "rollback-verify@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), verifyEnv, TEST_OPTIONS);
  const verifyToken = tokenFromLastEmail(verifyEnv, "verify");
  verifyEnv.TRG_ORDERS.failBatchStatement = 2;
  await assert.rejects(
    auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: verifyToken }), verifyEnv, TEST_OPTIONS),
    /Simulated dependent statement failure/
  );
  verifyEnv.TRG_ORDERS.failBatchStatement = 0;
  let user = await verifyEnv.TRG_ORDERS.prepare("SELECT email_verified FROM users WHERE email_normalized = ?").bind("rollback-verify@example.com").first();
  assert.equal(user.email_verified, 0, "Dependent verification failure must not leave the user verified.");
  let tokenRow = await verifyEnv.TRG_ORDERS.prepare("SELECT used_at, claim_marker FROM email_verification_tokens").first();
  assert.equal(tokenRow.used_at, null, "Dependent verification failure must roll back token consumption.");
  assert.equal(tokenRow.claim_marker, null, "Dependent verification failure must roll back the claim marker.");

  const resetEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "rollback-reset@example.com",
    password: "OriginalPassphrase!23",
    passwordConfirmation: "OriginalPassphrase!23"
  }), resetEnv, TEST_OPTIONS);
  await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "rollback-reset@example.com",
    password: "OriginalPassphrase!23"
  }), resetEnv, TEST_OPTIONS);
  await auth.requestPasswordReset(jsonRequest("/api/auth/request-password-reset", {
    email: "rollback-reset@example.com"
  }), resetEnv, TEST_OPTIONS);
  const resetToken = tokenFromLastEmail(resetEnv, "reset");
  resetEnv.TRG_ORDERS.failBatchStatement = 2;
  await assert.rejects(
    auth.resetPassword(jsonRequest("/api/auth/reset-password", {
      password: "RollbackPassphrase!24",
      passwordConfirmation: "RollbackPassphrase!24",
      token: resetToken
    }), resetEnv, TEST_OPTIONS),
    /Simulated dependent statement failure/
  );
  resetEnv.TRG_ORDERS.failBatchStatement = 0;
  const rollbackCredential = await resetEnv.TRG_ORDERS.prepare(`
    SELECT c.password_hash
    FROM password_credentials c JOIN users u ON u.id = c.user_id
    WHERE u.email_normalized = ?
  `).bind("rollback-reset@example.com").first();
  assert.equal(await auth.verifyPassword("OriginalPassphrase!23", rollbackCredential.password_hash), true, "Dependent reset failure must keep the original password.");
  assert.equal(await auth.verifyPassword("RollbackPassphrase!24", rollbackCredential.password_hash), false, "Dependent reset failure must not store the proposed password.");
  tokenRow = await resetEnv.TRG_ORDERS.prepare("SELECT used_at, claim_marker FROM password_reset_tokens").first();
  assert.equal(tokenRow.used_at, null, "Dependent reset failure must roll back token consumption.");
  assert.equal(tokenRow.claim_marker, null, "Dependent reset failure must roll back the claim marker.");
  const activeSessions = await resetEnv.TRG_ORDERS.prepare("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL").first();
  assert.equal(Number(activeSessions.count), 2, "Dependent reset failure must not revoke existing sessions.");
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

  response = await auth.loginWithGoogle(jsonRequest("/api/auth/google", {
    credential: "already-linked",
    g_csrf_token: "gis-csrf"
  }, { cookie: "g_csrf_token=gis-csrf" }), linkedEnv, {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => ({ payload: { email: "link@example.com", email_verified: true, sub: "google-linked-sub" } }) }
  });
  assert.equal(response.status, 200, "An already-linked Google identity should sign in normally.");
  assert.equal(await countRows(linkedEnv.TRG_ORDERS, "users"), 1, "Already-linked Google sign-in must not create a duplicate user.");
  assert.equal(await countRows(linkedEnv.TRG_ORDERS, "user_identities"), 1, "Already-linked Google sign-in must not create a duplicate identity.");

  const captureEnv = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "capture@example.com",
    password: "AttackerPassphrase!23",
    passwordConfirmation: "AttackerPassphrase!23"
  }), captureEnv, TEST_OPTIONS);
  const sessionCountBeforeBlockedGoogle = await countRows(captureEnv.TRG_ORDERS, "sessions");
  response = await auth.loginWithGoogle(jsonRequest("/api/auth/google", {
    credential: "capture",
    g_csrf_token: "gis-csrf"
  }, { cookie: "g_csrf_token=gis-csrf" }), captureEnv, {
    ...TEST_OPTIONS,
    google: { clientId: "google-client-id", jwtVerify: async () => ({ payload: { email: "capture@example.com", email_verified: true, sub: "google-capture-sub" } }) }
  });
  assert.equal(response.status, 409, "A verified Google email must not link to an unverified native account.");
  const capturePayload = await response.json();
  assert.equal(capturePayload.error.code, "google_signin_unavailable");
  assert.doesNotMatch(capturePayload.error.message, /unverified|exists|password|native|capture@example\.com/i, "Google failure should not expose unnecessary account details.");
  assert.equal(await countRows(captureEnv.TRG_ORDERS, "users"), 1, "Blocked Google sign-in must not create a duplicate user.");
  assert.equal(await countRows(captureEnv.TRG_ORDERS, "user_identities"), 0, "Blocked Google sign-in must not attach a Google identity.");
  assert.equal(await countRows(captureEnv.TRG_ORDERS, "sessions"), sessionCountBeforeBlockedGoogle, "Blocked Google sign-in must not create an authenticated session.");
  assert.equal(getCookies(response).filter((cookie) => cookie.startsWith("__Host-trg_session=")).length, 0, "Blocked Google sign-in must not set a session cookie.");
  const credential = await captureEnv.TRG_ORDERS.prepare("SELECT password_hash FROM password_credentials").first();
  assert.equal(await auth.verifyPassword("AttackerPassphrase!23", credential.password_hash), true, "Blocked Google sign-in must not alter the native credential.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "capture@example.com",
    password: "AttackerPassphrase!23"
  }), captureEnv, TEST_OPTIONS);
  assert.equal(response.status, 200, "The original unverified native credential remains only a native sign-in, not a Google-captured account.");
  assert.equal(await countRows(captureEnv.TRG_ORDERS, "user_identities"), 0, "Native sign-in after blocked Google linking must still have no Google identity attached.");
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

function createEnv(options = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  return {
    GOOGLE_CLIENT_ID: "google-client-id",
    RESEND_API_KEY: "re_test",
    RESEND_REPLY_TO: "reply@example.com",
    TRG_ORDERS: d1(raw, options),
    emailProvider: {
      messages: [],
      async send(message, options) {
        this.messages.push({ message, options });
        return { id: `email-${this.messages.length}`, status: "accepted" };
      }
    }
  };
}

function d1(raw, options = {}) {
  const api = {
    failBatchStatement: options.failBatchStatement || 0,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          if (api.failBatchStatement === index + 1) {
            throw new Error("Simulated dependent statement failure");
          }
          results.push(await statements[index].run());
        }
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
  return api;
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

async function canLogin(auth, env, email, password) {
  const response = await auth.loginAccount(jsonRequest("/api/auth/login", { email, password }), env, TEST_OPTIONS);
  return response.status === 200;
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
