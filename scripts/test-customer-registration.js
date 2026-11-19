const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://trg.test";
const NOW = Date.parse("2026-11-18T18:00:00.000Z");
const ISO = new Date(NOW).toISOString();

async function main() {
  await testMigrationPreservesExistingCardReference();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
  const db = d1(raw);
  const auth = await load("functions/_lib/account-auth.mjs");
  const profile = await load("functions/_lib/account-profile.mjs");
  const payments = await load("functions/_lib/customer-payment-methods.mjs");
  const library = await load("functions/_lib/account-library.mjs");
  const emails = [];
  const env = {
    TRG_ORDERS: db,
    PAYMENT_PIPELINE_STAGE: "staging",
    STRIPE_SECRET_KEY: "sk_test_customer_registration",
    STRIPE_PUBLISHABLE_KEY: "pk_test_customer_registration",
    emailProvider: { async send(message) { emails.push(message); return { id: `email_${emails.length}` }; } },
  };
  const authOptions = { disableRateLimit: true, now: NOW, passwordHashOptions: { N: 16, dkLen: 16, p: 1, r: 1 } };
  const registration = {
    customerRegistration: true,
    displayName: "RPG Customer",
    email: "customer@example.test",
    password: "SecurePassphrase!2026",
    passwordConfirmation: "SecurePassphrase!2026",
    firstName: "Riley", lastName: "Customer", company: "", addressLine1: "12 Main St",
    addressLine2: "Unit 4", city: "Raleigh", stateRegion: "NC", postalCode: "27601", country: "US",
    acceptTerms: true, acknowledgePrivacy: true,
  };
  let response = await auth.handleAccountAuthRequest(jsonRequest("/api/auth/register", { ...registration, acceptTerms: false }), env, authOptions);
  assert.equal(response.status, 400, "The Terms acceptance is mandatory at registration.");
  response = await auth.handleAccountAuthRequest(jsonRequest("/api/auth/register", { ...registration, phone: "555-0100" }), env, authOptions);
  assert.equal(response.status, 400, "Customer signup refuses telephone-number collection.");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0, "Rejected signup attempts create no account.");
  response = await auth.handleAccountAuthRequest(jsonRequest("/api/auth/register", registration), env, authOptions);
  assert.equal(response.status, 201, "Complete Customer signup creates the existing shared account.");
  let result = await response.json();
  assert.equal(result.user.role, "user", "Signup preserves the canonical account role.");
  assert.equal(result.user.customerPrivilegesActive, false, "New account is not a Customer until both activation gates pass.");
  assert.equal(emails.length, 1, "Existing email-verification delivery is reused.");
  const cookie = await cookieState(response, raw, auth);

  response = await profile.handleAccountProfileRequest(getRequest("/api/account/profile", cookie), env);
  assert.equal(response.status, 200, await response.clone().text());
  result = await response.json();
  assert.equal(result.user.displayName, "RPG Customer");
  assert.equal(result.user.billing.firstName, "Riley");
  assert.equal(result.user.billing.addressLine2, "Unit 4");
  assert.equal(result.user.phone, undefined, "Customer profile projection does not disclose telephone data.");
  assert.equal((await result.user.customerPrivilegesActive), false);

  response = await library.handleAccountLibraryRequest(new Request(`${ORIGIN}/api/account/library`, { headers: { cookie: cookie.header } }), env);
  assert.equal(response.status, 403, "Customer library access remains gated before registration activation.");

  let capturedRequests = [];
  let setupCount = 0;
  const setupIntents = new Map();
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const params = new URLSearchParams(init.body || "");
    capturedRequests.push({ url: parsed.pathname, body: params.toString(), headers: init.headers || {} });
    if (parsed.pathname === "/v1/customers") return stripeResponse({ id: "cus_customer001", livemode: false });
    if (parsed.pathname === "/v1/setup_intents" && init.method === "POST") {
      setupCount += 1;
      const id = `seti_customer00${setupCount}`;
      const attemptId = String(init.headers["idempotency-key"]).replace("trg-customer-setup-", "");
      setupIntents.set(id, { attemptId, methodId: `pm_customer00${setupCount}` });
      return stripeResponse({
        id, client_secret: `${id}_secret_browser_only`, customer: "cus_customer001", livemode: false, status: "requires_confirmation",
      });
    }
    if (parsed.pathname.startsWith("/v1/setup_intents/seti_customer00") && init.method === "GET") {
      const id = parsed.pathname.split("/").at(-1), intent = setupIntents.get(id);
      if (!intent) throw new Error(`Missing mock ${id}; known ${Array.from(setupIntents.keys()).join(",")}`);
      return stripeResponse({
        id, customer: "cus_customer001", livemode: false, status: "succeeded",
        metadata: { trg_user_id: cookie.userId, trg_attempt_id: intent.attemptId },
        payment_method: {
          id: intent.methodId, type: "card", customer: "cus_customer001",
        billing_details: { name: "Riley Customer" },
        card: { brand: "visa", last4: "4242", exp_month: 10, exp_year: 2030 },
        },
      });
    }
    if (parsed.pathname.endsWith("/detach")) return stripeResponse({ id: parsed.pathname.split("/").at(-2), object: "payment_method" });
    throw new Error(`Unexpected Stripe mock request: ${init.method} ${parsed.pathname}`);
  };
  const guardedFetch = (...args) => fetchImpl(...args);
  const paymentOptions = { fetchImpl: guardedFetch, nowMs: NOW };
  response = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "create_setup", idempotencyKey: "825a8fb1-fc0e-4c55-b081-38ab03c96811", savePaymentMethod: true,
  }), env, paymentOptions);
  assert.equal(response.status, 200);
  const setup = await response.json();
  assert.equal(setup.clientSecret, "seti_customer001_secret_browser_only");
  assert.equal(setup.publishableKey, env.STRIPE_PUBLISHABLE_KEY);
  assert.ok(capturedRequests.every((entry) => !/4242|cvc|card\[number\]/i.test(entry.body)), "No PAN/CVC is sent from TRG to Stripe API.");
  assert.ok(capturedRequests.every((entry) => !/\/payment_intents|\/charges/.test(entry.url)), "Registration saves a card without creating a charge or registration fee.");
  assert.ok(!JSON.stringify(setup).includes("4242"), "The setup response contains no card number or last four before confirmation.");

  response = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "confirm_setup", attemptId: setup.attemptId, setupIntentId: "seti_customer001",
  }), env, paymentOptions);
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.activated, false, "Successful card setup alone cannot activate an unverified email.");
  assert.equal(result.paymentMethods.length, 1);
  assert.equal(result.paymentMethods[0].last4, "4242");
  assert.equal(result.paymentMethods[0].expirationMonth, 10);
  assert.equal(result.paymentMethods[0].expirationYear, 2030);

  const registrationToken = new URL(emails[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get("verify");
  response = await auth.handleAccountAuthRequest(jsonRequest("/api/auth/verify-email", { token: registrationToken }), env,
    { disableRateLimit: true, now: NOW + 1000 });
  assert.equal(response.status, 200);
  const state = raw.prepare("SELECT state,activated_at FROM customer_registration_states WHERE user_id=?").get(cookie.userId);
  assert.equal(state.state, "active", "Verified email plus saved card activates Customer access automatically.");
  assert.ok(state.activated_at);

  response = await profile.handleAccountProfileRequest(getRequest("/api/account/profile", cookie), env);
  assert.equal((await response.json()).user.customerPrivilegesActive, true);
  response = await library.handleAccountLibraryRequest(new Request(`${ORIGIN}/api/account/library`, { headers: { cookie: cookie.header } }), env);
  assert.equal(response.status, 200, "Activated Customer can open the personal library before any purchase.");
  assert.deepEqual((await response.json()).items, [], "New Customer starts with an empty personal library.");

  // Confirm ownership isolation, card management, and preservation of Customer access.
  const secondSetupResponse = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "create_setup", idempotencyKey: "921ef156-10c6-49a5-a721-07d16e167a71", savePaymentMethod: true,
  }), env, paymentOptions);
  assert.equal(secondSetupResponse.status, 200);
  const secondSetup = await secondSetupResponse.json();
  response = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "confirm_setup", attemptId: secondSetup.attemptId, setupIntentId: "seti_customer002",
  }), env, paymentOptions);
  assert.equal(response.status, 200, await response.clone().text());
  result = await response.json();
  assert.equal(result.paymentMethods.length, 2, "Customer profile can add another card after initial registration.");
  assert.equal(result.paymentMethods.filter((method) => method.id === "pm_customer001")[0].id, "pm_customer001");
  response = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "set_default", paymentMethodId: "pm_customer002",
  }), env, paymentOptions);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).defaultId, "pm_customer002");
  response = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "remove", paymentMethodId: "pm_customer001",
  }), env, paymentOptions);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paymentMethods.length, 1);
  assert.equal((await raw.prepare("SELECT role FROM users WHERE id=?").get(cookie.userId)).role, "user",
    "Customer identity remains the same canonical account after profile and payment changes.");
  const foreignRequest = await payments.handleCustomerPaymentMethodsRequest(accountRequest("/api/account/payment-methods", cookie, {
    action: "remove", paymentMethodId: "pm_otheruser",
  }), env, paymentOptions);
  assert.equal(foreignRequest.status, 404, "A nonexistent or other account's card cannot be removed.");
  raw.prepare("UPDATE users SET role='admin' WHERE id=?").run(cookie.userId);
  response = await library.handleAccountLibraryRequest(getRequest("/api/account/library", cookie), env);
  assert.equal(response.status, 200, "Elevating the same account preserves its Customer library access.");
  assert.equal((await profile.handleAccountProfileRequest(getRequest("/api/account/profile", cookie), env)).status, 200,
    "Higher account tiers retain access to their Customer profile.");
  raw.close();
  console.log("Customer registration and saved-card regressions passed.");
}

async function testMigrationPreservesExistingCardReference() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  const migrations = fs.readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const file of migrations.filter((name) => name < "079_customer_signup_and_saved_cards.sql")) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES('legacy-card-user','legacy@example.test',1,'active','user',?,?)").run(ISO, ISO);
  raw.prepare(`INSERT INTO user_account_profiles(user_id,stripe_customer_reference,default_payment_method_reference,
      payment_card_brand,payment_card_last4,payment_method_status,created_at,updated_at)
    VALUES('legacy-card-user','cus_legacy123','pm_legacy123','mastercard','1881','ready',?,?)`).run(ISO, ISO);
  raw.exec(fs.readFileSync(path.join(ROOT, "migrations", "079_customer_signup_and_saved_cards.sql"), "utf8"));
  const preserved = raw.prepare("SELECT * FROM user_account_profiles WHERE user_id='legacy-card-user'").get();
  assert.equal(preserved.stripe_customer_reference, "cus_legacy123");
  assert.equal(preserved.default_payment_method_reference, "pm_legacy123");
  assert.equal(preserved.payment_card_brand, "mastercard");
  assert.equal(preserved.payment_card_last4, "1881");
  const imported = raw.prepare("SELECT * FROM customer_saved_payment_methods WHERE payment_method_reference='pm_legacy123'").get();
  assert.ok(imported, "The existing account card remains visible in the Customer card manager.");
  assert.equal(imported.expiration_month, null, "Unknown historical expiry is not fabricated during migration.");
  assert.equal(imported.expiration_year, null);

  const auth = await load("functions/_lib/account-auth.mjs");
  const payments = await load("functions/_lib/customer-payment-methods.mjs");
  const db = d1(raw);
  const token = "legacy-card-session-token", csrf = "legacy-card-csrf";
  raw.prepare(`INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at)
    VALUES('legacy-card-session','legacy-card-user',?,?,?,? ,?)`)
    .run(await auth.hashToken(token), await auth.hashToken(csrf), ISO, "2027-11-18T00:00:00.000Z", ISO);
  const paymentEnv = { TRG_ORDERS: db, PAYMENT_PIPELINE_STAGE: "staging", STRIPE_SECRET_KEY: "sk_test_legacy", STRIPE_PUBLISHABLE_KEY: "pk_test_legacy" };
  const response = await payments.handleCustomerPaymentMethodsRequest(new Request(`${ORIGIN}/api/account/payment-methods`, {
    headers: { cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}` },
  }), paymentEnv, { nowMs: NOW, fetchImpl: async (url) => {
    assert.match(url, /\/payment_methods\/pm_legacy123$/);
    return stripeResponse({ id: "pm_legacy123", type: "card", customer: "cus_legacy123",
      billing_details: { name: "Legacy Customer" }, card: { brand: "mastercard", last4: "1881", exp_month: 9, exp_year: 2031 } });
  } });
  assert.equal(response.status, 200);
  const listed = await response.json();
  assert.equal(listed.paymentMethods[0].expirationMonth, 9, "Existing card metadata is completed from the Stripe provider reference.");
  assert.equal(listed.paymentMethods[0].expirationYear, 2031);
  raw.close();
}

function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return { bind(...next) { values = next; return this; },
        first: async () => raw.prepare(sql).get(...values) || null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }),
        run: async () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) }, changes: Number(result.changes) }; } };
    },
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };
}
function jsonRequest(pathname, body) { return new Request(`${ORIGIN}${pathname}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }); }
function accountRequest(pathname, cookie, body) { return new Request(`${ORIGIN}${pathname}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: cookie.header, "x-csrf-token": cookie.csrf }, body: JSON.stringify(body) }); }
function getRequest(pathname, cookie) { return new Request(`${ORIGIN}${pathname}`, { headers: { cookie: cookie.header } }); }
async function cookieState(response, raw, auth) {
  const header = response.headers.get("set-cookie") || "";
  const session = header.match(/__Host-trg_session=([^;,]+)/)?.[1];
  const csrf = header.match(/trg_account_csrf=([^;,]+)/)?.[1];
  assert.ok(session && csrf, "Signup must create its existing secure authenticated session and CSRF cookies.");
  const sessionHash = await auth.hashToken(session);
  const row = raw.prepare("SELECT user_id FROM sessions WHERE token_hash=?").get(sessionHash);
  assert.ok(row?.user_id);
  return { header: `__Host-trg_session=${session}; trg_account_csrf=${csrf}`, csrf, session, userId: row.user_id };
}
function stripeResponse(payload) { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
function load(relative) { return import(pathToFileURL(path.join(ROOT, relative)).href); }

main().catch((error) => { console.error(error); process.exitCode = 1; });
