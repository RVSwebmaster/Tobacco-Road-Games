const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = [
  "007_shared_accounts.sql",
  "008_token_claim_markers.sql"
].map((file) => fs.readFileSync(path.join(ROOT, "migrations", file), "utf8")).join("\n");
const FOCUSED_ACCOUNT_PROFILE_MIGRATION = fs.readFileSync(
  path.join(ROOT, "ops", "releases", "account-profile-072", "account-profile-072.sql"),
  "utf8"
);
const ORIGIN = "https://tobaccoroadgames.com";
const TEST_OPTIONS = Object.freeze({
  disableRateLimit: true,
  now: Date.now(),
  passwordHashOptions: { N: 16, dkLen: 16, p: 1, r: 1 }
});

async function main() {
  const auth = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "account-auth.mjs")).href);
  await testPasswordHashing(auth);
  await testInputLimits(auth);
  await testRegistrationDoesNotRequireEmail(auth);
  await testRegistrationLoginSessionLogout(auth);
  await testAccessOwnerBridge(auth);
  await testLegacyVerificationCompatibility(auth);
  await testPasswordReset(auth);
  await testTokenReplayRaces(auth);
  await testTokenClaimRollback(auth);
  await testNoExternalIdentityProvider(auth);
  await testTokenStorageAndRateLimits(auth);
  assertAccountPageAndRoutes();
  assertNoAuthBoundaryChanges();
  console.log("Shared account auth tests passed.");
}

async function testAccessOwnerBridge(auth) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(MIGRATION);
  raw.exec(`
    CREATE TABLE marketplace_creators (id TEXT PRIMARY KEY);
    CREATE TABLE creator_memberships (
      user_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, creator_id)
    );
    CREATE TABLE creator_identity_ownership (
      creator_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      identity_type TEXT NOT NULL,
      account_status TEXT NOT NULL,
      billing_status TEXT NOT NULL,
      entitlement_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO marketplace_creators(id) VALUES('creator-rv-sawyer');
  `);
  const env = { TRG_ORDERS: d1(raw) };
  const first = await auth.establishAccessOwnerSession(env, "owner@example.com", TEST_OPTIONS);
  assert.equal(first.user.role, "owner");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM creator_memberships").get().count, 1);
  const ownership = raw.prepare("SELECT * FROM creator_identity_ownership").get();
  assert.equal(ownership.owner_user_id, first.user.id);
  assert.equal(ownership.identity_type, "primary");
  assert.equal(ownership.account_status, "active");
  assert.equal(ownership.entitlement_source, "legacy_grandfathered");

  await auth.establishAccessOwnerSession(env, "owner@example.com", TEST_OPTIONS);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM creator_memberships").get().count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM creator_identity_ownership").get().count, 1);
  const ownerPassword = "OwnerPassphrase!2026";
  const ownerHash = await auth.hashPassword(ownerPassword, TEST_OPTIONS.passwordHashOptions);
  raw.prepare("INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(first.user.id, ownerHash, new Date(TEST_OPTIONS.now).toISOString(), new Date(TEST_OPTIONS.now).toISOString());
  const ownerLogin = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "owner@example.com",
    password: ownerPassword
  }), env, TEST_OPTIONS);
  assert.equal(ownerLogin.status, 200, "An existing verified Owner account must continue to authenticate.");
  assert.equal((await ownerLogin.json()).user.role, "owner");
}

async function testPasswordHashing(auth) {
  const hash = await auth.hashPassword("ValidPassphrase!23", TEST_OPTIONS.passwordHashOptions);
  assert.match(hash, /^scrypt\$/, "Native account passwords must use scrypt hashes.");
  assert.equal(await auth.verifyPassword("ValidPassphrase!23", hash), true);
  assert.equal(await auth.verifyPassword("wrong", hash), false);
  assert.doesNotMatch(hash, /ValidPassphrase/, "Password hashes must not contain plaintext.");
}

async function testInputLimits(auth) {
  let response = await auth.registerAccount(rawJsonRequest("/api/auth/register", `{"padding":"${"x".repeat(17 * 1024)}"}`), {}, TEST_OPTIONS);
  assert.equal(response.status, 413, "Oversized JSON bodies should be rejected.");
  assert.equal((await response.json()).error.code, "request_too_large");

  response = await auth.registerAccount(rawJsonRequest("/api/auth/register", `{"padding":"${"x".repeat(17 * 1024)}"}`, { "content-length": "1" }), {}, TEST_OPTIONS);
  assert.equal(response.status, 413, "A false small Content-Length header must not bypass the actual body-size limit.");

  response = await auth.registerAccount(rawJsonRequest("/api/auth/register", `{"padding":"${"x".repeat(17 * 1024)}"}`, { "content-length": "" }), {}, TEST_OPTIONS);
  assert.equal(response.status, 413, "A missing Content-Length header must not bypass the actual body-size limit.");

  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "oversized-password@example.com",
    password: `${"A".repeat(255)}1!`,
    passwordConfirmation: `${"A".repeat(255)}1!`
  }), {}, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized registration passwords should be rejected before database or scrypt work.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "oversized-login-password@example.com",
    password: `${"A".repeat(255)}1!`
  }), {}, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized login passwords should be rejected before database or scrypt verification.");

  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: `${"a".repeat(250)}@example.com`,
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), {}, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized email fields should be rejected before normalization or database lookup.");

  const tokenEnv = createEnv();
  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", {
    token: "x".repeat(129)
  }), tokenEnv, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized verification tokens should be rejected.");
  assert.equal(tokenEnv.TRG_ORDERS.prepareCount, 0, "Oversized verification tokens must be rejected before database lookup.");

  response = await auth.resetPassword(jsonRequest("/api/auth/reset-password", {
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23",
    token: "x".repeat(129)
  }), tokenEnv, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized reset tokens should be rejected.");
  assert.equal(tokenEnv.TRG_ORDERS.prepareCount, 0, "Oversized reset tokens must be rejected before database lookup.");

  const resendEnv = createEnv();
  response = await auth.resendVerification(new Request(`${ORIGIN}/api/auth/resend-verification`, {
    body: "{}",
    headers: {
      "content-type": "application/json",
      cookie: `trg_account_csrf=${"x".repeat(129)}`,
      origin: ORIGIN,
      "x-csrf-token": "x".repeat(129)
    },
    method: "POST"
  }), resendEnv, TEST_OPTIONS);
  assert.equal(response.status, 400, "Oversized account CSRF tokens should be rejected on resend requests.");
  assert.equal(resendEnv.TRG_ORDERS.prepareCount, 0, "Oversized resend CSRF tokens must be rejected before database lookup.");

  const sessionEnv = createEnv();
  const sessionLookup = await auth.handleAccountMeRequest(new Request(`${ORIGIN}/api/account/me`, {
    headers: { cookie: `__Host-trg_session=${"x".repeat(129)}` }
  }), sessionEnv);
  assert.equal((await sessionLookup.json()).authenticated, false, "Oversized session cookies should not authenticate.");
  assert.equal(sessionEnv.TRG_ORDERS.prepareCount, 0, "Oversized session cookies should be rejected before database lookup.");

  const maxEnv = createEnv();
  const maxEmail = `${"a".repeat(249)}@e.co`;
  const maxPassword = `A1!${"a".repeat(253)}`;
  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: maxEmail,
    password: maxPassword,
    passwordConfirmation: maxPassword
  }), maxEnv, TEST_OPTIONS);
  assert.equal(response.status, 201, "Valid maximum-length email and password should reach the successful registration path.");

  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", {
    token: "x".repeat(128)
  }), createEnv(), TEST_OPTIONS);
  assert.equal(response.status, 410, "Maximum-length verification tokens should reach the normal invalid-token path.");


}

async function testRegistrationDoesNotRequireEmail(auth) {
  const env = createEnv({ omitEmailProvider: true, resendApiKey: "", resendReplyTo: "" });
  const originalFetch = globalThis.fetch;
  let outboundRequests = 0;
  globalThis.fetch = async (...args) => {
    outboundRequests += 1;
    return originalFetch(...args);
  };
  try {
    const response = await auth.registerAccount(jsonRequest("/api/auth/register", {
      email: "no-mail@example.com",
      password: "ValidPassphrase!23",
      passwordConfirmation: "ValidPassphrase!23"
    }), env, TEST_OPTIONS);
    assert.equal(response.status, 201, "Registration should succeed without mail-provider configuration.");
    assert.match((await response.json()).message, /sign in now/i);
    assert.equal(outboundRequests, 0, "Registration must not contact an email provider.");
    assert.equal(await countRows(env.TRG_ORDERS, "users"), 1);
    assert.equal(await countRows(env.TRG_ORDERS, "password_credentials"), 1);
    assert.equal(await countRows(env.TRG_ORDERS, "email_verification_tokens"), 0);
    assert.equal(await countRows(env.TRG_ORDERS, "customer_registration_states"), 1);
    assert.equal(await countRows(env.TRG_ORDERS, "sessions"), 1);
    const state = await env.TRG_ORDERS.prepare("SELECT state, activated_at FROM customer_registration_states").first();
    assert.equal(state.state, "active", "New Customer registration must create an active registration state.");
    assert.ok(state.activated_at, "Active registration state should record activation immediately.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRegistrationLoginSessionLogout(auth) {
  const env = createEnv({ omitEmailProvider: true, resendApiKey: "", resendReplyTo: "" });
  let response = await auth.handleAccountMeRequest(new Request(`${ORIGIN}/api/account/me`), env);
  let payload = await response.json();
  assert.equal(payload.authenticated, false, "Anonymous account lookup should remain unauthenticated.");
  assert.match(payload.csrfToken, /^[A-Za-z0-9_-]+$/, "Anonymous account lookup should issue a TRG CSRF token.");
  assert.ok(getCookies(response).some((cookie) => cookie.startsWith("trg_account_csrf=")), "Anonymous account lookup should set the TRG CSRF cookie.");

  response = await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: " Player@Example.COM ",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 201, "Successful registration should create an account.");
  payload = await response.json();
  assert.equal(payload.user.email, "player@example.com");
  assert.equal(payload.user.emailVerified, false);
  const memberId = payload.user.id;
  const credential = await env.TRG_ORDERS.prepare("SELECT password_hash FROM password_credentials WHERE user_id = ?").bind(memberId).first();
  assert.match(credential.password_hash, /^scrypt\$/);
  const verificationRows = await env.TRG_ORDERS.prepare("SELECT COUNT(*) AS count FROM email_verification_tokens WHERE user_id = ?").bind(memberId).first();
  assert.equal(Number(verificationRows.count), 0, "Registration should not create a verification token.");
  const registrationState = await env.TRG_ORDERS.prepare("SELECT state, activated_at FROM customer_registration_states WHERE user_id = ?").bind(memberId).first();
  assert.equal(registrationState.state, "active", "Registration should persist an active state immediately.");
  assert.ok(registrationState.activated_at);
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

  const registrationCookie = cookieHeaderFrom(cookies);
  assert.equal(await auth.customerPrivilegesActive(env.TRG_ORDERS, memberId), true, "Unverified accounts with active status have Customer privileges.");
  let customerSession = await auth.getCustomerSessionFromRequest(new Request(`${ORIGIN}/customer`, {
    headers: { cookie: registrationCookie }
  }), env, TEST_OPTIONS);
  assert.equal(customerSession.valid, true, "Registration should issue an immediately usable Customer session.");
  const activeStorefront = await requestCustomerStorefront(auth, env, registrationCookie);
  assert.equal(activeStorefront.response.status, 200, "An authenticated Customer may open /customer immediately.");
  assert.equal(activeStorefront.nextCalled, true);

  // Existing active Customer records may still have stale pending/unverified metadata.
  await env.TRG_ORDERS.prepare(`
    UPDATE customer_registration_states SET state = 'pending', activated_at = NULL WHERE user_id = ?
  `).bind(memberId).run();
  assert.equal(await auth.customerPrivilegesActive(env.TRG_ORDERS, memberId), true, "Legacy pending metadata must not strand an active Customer.");
  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "Email/password login must work when email_verified is false and legacy state is pending.");
  const loginCookies = getCookies(response);
  assert.ok(loginCookies.some((cookie) => cookie.startsWith("__Host-trg_session=")));
  const cookieHeader = cookieHeaderFrom(loginCookies);
  customerSession = await auth.getCustomerSessionFromRequest(new Request(`${ORIGIN}/customer`, {
    headers: { cookie: cookieHeader }
  }), env, TEST_OPTIONS);
  assert.equal(customerSession.valid, true, "The newly logged-in Customer session should open /customer.");

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "wrong"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 401, "Invalid native login should be rejected generically.");
  payload = await response.json();
  assert.equal(payload.error.code, "invalid_login");

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

  const signedOutStorefront = await requestCustomerStorefront(auth, env, cookieHeader);
  assert.equal(signedOutStorefront.response.status, 302, "Signed-out access to /customer should be redirected.");
  assert.equal(new URL(signedOutStorefront.response.headers.get("location")).pathname, "/guest/");
  assert.equal(signedOutStorefront.nextCalled, false);

  response = await auth.loginAccount(jsonRequest("/api/auth/login", {
    email: "player@example.com",
    password: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "The Customer should be able to log in again after logout.");
}

async function testLegacyVerificationCompatibility(auth) {
  const env = createEnv();
  const { id, token } = await seedLegacyPendingAccount(auth, env, "verify@example.com");
  assert.equal(await auth.customerPrivilegesActive(env.TRG_ORDERS, id), true, "A legacy active account remains usable while pending metadata exists.");
  let response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token }), env, TEST_OPTIONS);
  assert.equal(response.status, 200, "A previously issued verification link remains usable.");
  let user = await env.TRG_ORDERS.prepare("SELECT * FROM users WHERE email_normalized = ?").bind("verify@example.com").first();
  assert.equal(user.email_verified, 1);
  const activeState = await env.TRG_ORDERS.prepare("SELECT state, activated_at FROM customer_registration_states WHERE user_id = ?").bind(user.id).first();
  assert.equal(activeState.state, "active", "Verification must promote pending Customer registration.");
  assert.ok(activeState.activated_at);
  assert.equal(await auth.customerPrivilegesActive(env.TRG_ORDERS, user.id), true);

  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token }), env, TEST_OPTIONS);
  assert.equal(response.status, 410, "Reused verification token should be rejected.");

  const expired = await seedLegacyPendingAccount(auth, env, "expired-verify@example.com");
  response = await auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: expired.token }), env, {
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
  const { token: verifyToken } = await seedLegacyPendingAccount(auth, verifyEnv, "race-verify@example.com");
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
  const { token: verifyToken } = await seedLegacyPendingAccount(auth, verifyEnv, "rollback-verify@example.com");
  verifyEnv.TRG_ORDERS.failBatchStatement = 3;
  await assert.rejects(
    auth.verifyEmail(jsonRequest("/api/auth/verify-email", { token: verifyToken }), verifyEnv, TEST_OPTIONS),
    /Simulated dependent statement failure/
  );
  verifyEnv.TRG_ORDERS.failBatchStatement = 0;
  let user = await verifyEnv.TRG_ORDERS.prepare("SELECT email_verified FROM users WHERE email_normalized = ?").bind("rollback-verify@example.com").first();
  assert.equal(user.email_verified, 0, "Dependent verification failure must not leave the user verified.");
  const registrationState = await verifyEnv.TRG_ORDERS.prepare("SELECT state FROM customer_registration_states WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)").bind("rollback-verify@example.com").first();
  assert.equal(registrationState.state, "pending", "A failed promotion must leave Customer registration pending.");
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

async function testNoExternalIdentityProvider(auth) {
  const env = createEnv();
  const csrfResponse = await auth.handleAccountAuthRequest(new Request(ORIGIN + "/api/auth/register", {
    body: JSON.stringify({ email: "csrf@example.com", password: "ValidPassphrase!23", passwordConfirmation: "ValidPassphrase!23" }),
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    method: "POST"
  }), env, TEST_OPTIONS);
  assert.equal(csrfResponse.status, 403, "Cross-origin account mutation should be rejected.");

  const googleResponse = await auth.handleAccountAuthRequest(new Request(ORIGIN + "/api/auth/google", {
    body: JSON.stringify({ credential: "unused" }),
    headers: { "content-type": "application/json", origin: ORIGIN },
    method: "POST"
  }), env, TEST_OPTIONS);
  assert.equal(googleResponse.status, 404, "The Google sign-in endpoint must not exist in the native account system.");
}

async function testTokenStorageAndRateLimits(auth) {
  const env = createEnv();
  await auth.registerAccount(jsonRequest("/api/auth/register", {
    email: "stored-token@example.com",
    password: "ValidPassphrase!23",
    passwordConfirmation: "ValidPassphrase!23"
  }), env, TEST_OPTIONS);
  assert.equal(await countRows(env.TRG_ORDERS, "email_verification_tokens"), 0, "Normal registration should not create verification tokens.");

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
  raw.exec(`
    CREATE TABLE marketplace_creators (id TEXT PRIMARY KEY);
    CREATE TABLE user_account_profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  raw.exec(FOCUSED_ACCOUNT_PROFILE_MIGRATION);
  const env = {
    RESEND_API_KEY: options.resendApiKey ?? "re_test",
    RESEND_REPLY_TO: options.resendReplyTo ?? "reply@example.com",
    TRG_ORDERS: d1(raw, options),
  };
  if (!options.omitEmailProvider) {
    env.emailProvider = {
      messages: [],
      async send(message, options) {
        this.messages.push({ message, options });
        return { id: `email-${this.messages.length}`, status: "accepted" };
      }
    };
  }
  return env;
}

function d1(raw, options = {}) {
  const api = {
    failBatchStatement: options.failBatchStatement || 0,
    prepareCount: 0,
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
      api.prepareCount += 1;
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

function rawJsonRequest(pathname, body, headers = {}) {
  const normalizedHeaders = {
    "content-type": "application/json",
    origin: ORIGIN,
    ...headers
  };
  for (const [name, value] of Object.entries({ ...normalizedHeaders })) {
    if (value === "") delete normalizedHeaders[name];
  }
  return new Request(`${ORIGIN}${pathname}`, {
    body,
    headers: normalizedHeaders,
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

async function seedLegacyPendingAccount(auth, env, email) {
  const id = `legacy-${email.replace(/[^a-z0-9]+/gi, "-")}`;
  const token = `legacy-verification-${id}`;
  const now = new Date(TEST_OPTIONS.now).toISOString();
  await env.TRG_ORDERS.batch([
    env.TRG_ORDERS.prepare(`
      INSERT INTO users (id, email_normalized, email_verified, status, role, created_at, updated_at)
      VALUES (?, ?, 0, 'active', 'user', ?, ?)
    `).bind(id, email, now, now),
    env.TRG_ORDERS.prepare(`
      INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind(id, await auth.hashPassword("ValidPassphrase!23", TEST_OPTIONS.passwordHashOptions), now, now),
    env.TRG_ORDERS.prepare(`
      INSERT INTO customer_registration_states (user_id, state, activated_at, created_at, updated_at)
      VALUES (?, 'pending', NULL, ?, ?)
    `).bind(id, now, now),
    env.TRG_ORDERS.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`token-${id}`, id, await auth.hashToken(token), now, new Date(TEST_OPTIONS.now + 24 * 60 * 60 * 1000).toISOString())
  ]);
  return { id, token };
}

async function countRows(db, table) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
  return Number(row.count || 0);
}

async function requestCustomerStorefront(auth, env, cookie) {
  const source = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8")
    .replace(/^import .*;\s*$/gm, "")
    .replace("export async function onRequest(context)", "async function onRequest(context)")
    + "\nglobalThis.testOnRequest = onRequest;";
  const sandbox = {
    URL,
    Headers,
    Response,
    getCustomerSessionFromRequest: auth.getCustomerSessionFromRequest,
    isMarketplaceWriteDisabled: () => false,
    marketplaceWriteDisabledResponse: () => new Response("writes disabled", { status: 503 }),
    handleOfficeMiddleware: async () => new Response("office"),
    readStoreState: async () => ({ available: false }),
    isPublicStorePage: () => false,
    maintenanceResponse: () => new Response("maintenance"),
    attachOwnerSessionForDocument: async (response) => response
  };
  vm.runInNewContext(source, sandbox, { filename: "functions/_middleware.js" });
  let nextCalled = false;
  const response = await sandbox.testOnRequest({
    request: new Request(`${ORIGIN}/customer`, { headers: { cookie } }),
    env,
    next: async () => {
      nextCalled = true;
      return new Response("Customer document", { headers: { "content-type": "text/plain" } });
    }
  });
  return { nextCalled, response };
}

async function canLogin(auth, env, email, password) {
  const response = await auth.loginAccount(jsonRequest("/api/auth/login", { email, password }), env, TEST_OPTIONS);
  return response.status === 200;
}

function assertNoAuthBoundaryChanges() {
  for (const relative of [
    "functions/_lib/stripe-checkout.mjs",
    "functions/_lib/download-authorization.mjs",
    "functions/_lib/office-access.mjs"
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /account-auth|password_credentials|user_identities/, `${relative} should not depend on public account auth.`);
  }
}

function assertAccountPageAndRoutes() {
  const accountPage = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
  assert.doesNotMatch(accountPage, /Google|google|accounts\.google/i, "Account page must use only native TRG authentication.");
  assert.match(accountPage, /id="signin-form"/, "Account page should offer native sign-in.");
  assert.match(accountPage, /id="register-form"/, "Account page should offer native registration.");
  assert.match(accountPage, /id="forgot-form"/, "Account page should offer password reset.");
  assert.match(accountPage, /id="reset-form"/, "Account page should accept a reset token and new password.");
  assert.match(accountPage, /data-account-view="register"/, "Account page should link to Sign Up.");
  assert.match(accountPage, /data-account-view="forgot"/, "Account page should link to Forgot Password.");
  assert.match(accountPage, /Sign Out/i, "Account page should offer sign-out.");
  const accountScript = fs.readFileSync(path.join(ROOT, "assets", "js", "account.js"), "utf8");
  assert.doesNotMatch(accountScript, /\/api\/auth\/google|Google|google/i, "Account script must not load or submit external identity credentials.");
  assert.match(accountScript, /\/api\/account\/me/, "Account script should load account state from the account API.");
  assert.match(accountScript, /data-account-view/, "Account access panels should have working navigation.");
  assert.doesNotMatch(accountScript, /rewrite|autofix/i, "Account UI must not add rewriting-style behavior.");
  assert.doesNotMatch(accountScript, /credentialResponse\.(?:picture|photo)|payload\.picture/i, "Account UI must not import Google profile imagery.");
  const middleware = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8");
  assert.match(middleware, /getCustomerSessionFromRequest/, "The Customer Storefront route must enforce an active authenticated Customer session.");

  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/auth/*"), "Cloudflare routes should include account auth functions.");
  assert.ok(routes.include.includes("/api/account/me"), "Cloudflare routes should include account state lookup.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

