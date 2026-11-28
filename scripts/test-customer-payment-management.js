const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  const { handleCustomerPaymentMethods } = await import("../functions/_lib/customer-payment-methods.mjs");
  const mappings = new Map();
  let configuration = null;
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        args: [], bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM customer_stripe_accounts")) return mappings.has(this.args[0]) ? { stripe_customer_reference: mappings.get(this.args[0]) } : null;
          if (sql.includes("FROM customer_payment_portal_configurations")) return configuration ? { configuration_reference: configuration } : null;
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO customer_stripe_accounts")) mappings.set(this.args[0], this.args[1]);
          if (sql.startsWith("INSERT INTO customer_payment_portal_configurations")) configuration = this.args[1];
          return { success: true };
        },
      };
    },
  };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const params = new URLSearchParams(init.body);
    calls.push({ path, params, headers: init.headers });
    let payload;
    if (path.endsWith("/customers") && init.method === "POST") payload = { id: "cus_customer1", livemode: false };
    else if (path.endsWith("/billing_portal/configurations")) payload = { id: "bpc_config1", livemode: false };
    else if (path.endsWith("/billing_portal/sessions")) payload = { url: "https://billing.stripe.com/p/session_test", livemode: false };
    else if (path.endsWith("/customers/cus_customer1")) payload = { livemode: false, invoice_settings: { default_payment_method: "pm_default" }, address: { city: "Raleigh", state: "NC", postal_code: "27601", country: "US" } };
    else if (path.endsWith("/payment_methods")) payload = { data: [
      { id: "pm_default", type: "card", card: { brand: "visa", last4: "4242", exp_month: 10, exp_year: 2030, number: "never return this" } },
      { id: "pm_other", type: "card", card: { brand: "mastercard", last4: "1111", exp_month: 5, exp_year: 2029 } },
    ] };
    else throw new Error(`Unexpected mocked Stripe request: ${path}`);
    return Response.json(payload);
  };
  const options = {
    database: db, fetchImpl, nowMs: Date.UTC(2026, 10, 28),
    getSession: async () => ({ valid: true, csrfToken: "csrf", user: { id: "cust-1", email_normalized: "customer@example.test", role: "user" } }),
    resolveAccess: async () => ({ accountClass: "customer" }),
    validateOrigin: () => true, validateCsrf: async () => ({ valid: true }),
  };
  const env = { STRIPE_SECRET_KEY: "sk_test_safe", PAYMENT_PIPELINE_STAGE: "staging" };
  const portalRequest = new Request("https://trg-staging.pages.dev/api/account/payment-methods/portal", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "payment_methods" }),
  });
  const portalResponse = await handleCustomerPaymentMethods(portalRequest, env, options);
  assert.equal(portalResponse.status, 200);
  assert.equal((await portalResponse.json()).url, "https://billing.stripe.com/p/session_test");
  assert.equal(mappings.get("cust-1"), "cus_customer1", "Customer payment mapping is stored separately from Creator billing.");
  assert.equal(configuration, "bpc_config1");
  assert.equal(calls[0].params.get("metadata[trg_user_id]"), "cust-1");
  assert.equal(calls[0].headers["idempotency-key"], "trg-customer-payment-cust-1");
  assert.equal(calls.find((call) => call.path.endsWith("/billing_portal/configurations")).params.get("features[payment_method_update][enabled]"), "true");

  const listResponse = await handleCustomerPaymentMethods(new Request("https://trg-staging.pages.dev/api/account/payment-methods"), env, options);
  const listing = await listResponse.json();
  assert.equal(listing.methods.length, 2);
  assert.deepEqual(listing.methods[0], { brand: "visa", last4: "4242", expMonth: 10, expYear: 2030, isDefault: true });
  assert.equal(JSON.stringify(listing).includes("never return this"), false, "Raw card data is never returned.");
  assert.deepEqual(listing.billingAddress, { city: "Raleigh", state: "NC", postal_code: "27601", country: "US" });

  let stripeCalls = 0;
  const forbidden = await handleCustomerPaymentMethods(portalRequest, env, {
    ...options, resolveAccess: async () => ({ accountClass: "creator" }), fetchImpl: async () => { stripeCalls++; },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(stripeCalls, 0, "Creator-class accounts cannot access Customer payment management.");

  const missingKey = await handleCustomerPaymentMethods(new Request("https://trg-staging.pages.dev/api/account/payment-methods/portal", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "payment_methods" }),
  }), { ...env, STRIPE_SECRET_KEY: "sk_live_wrong_mode" }, options);
  assert.equal(missingKey.status, 503, "Staging must fail closed when configured with a live key.");

  const generated = fs.readFileSync("customer-profile/index.html", "utf8");
  assert.match(generated, /id="payment-methods"[\s\S]*?id="purchase-history"/);
  assert.match(generated, /Add, remove or choose a default payment method/);
  assert.match(generated, /data-membership-profile-form/);
  console.log("Customer payment management tests passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
