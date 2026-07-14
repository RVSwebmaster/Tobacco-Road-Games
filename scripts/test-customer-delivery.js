const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = ["001_direct_storefront.sql", "003_checkout_attempt_idempotency.sql", "004_verified_stripe_webhooks.sql", "005_secure_download_entitlements.sql", "006_customer_delivery_owner_controls.sql"]
  .map((name) => path.join(ROOT, "migrations", name));
const NOW = Date.parse("2026-07-14T20:00:00.000Z");
const ACCESS_SECRET = "order-access-signing-secret-at-least-thirty-two-bytes";
const DOWNLOAD_SECRET = "download-signing-secret-at-least-thirty-two-bytes";
const RESEND_SECRET = `whsec_${Buffer.from("resend-webhook-test-key-material").toString("base64")}`;
const PDF = new TextEncoder().encode("%PDF-1.7\nAgency test\n%%EOF\n");
let sequence = 0;

async function main() {
  const modules = {
    access: await load("functions/_lib/order-access.mjs"),
    accessPage: await load("functions/_lib/order-access-page.mjs"),
    delivery: await load("functions/_lib/order-delivery.mjs"),
    download: await load("functions/_lib/download-route.mjs"),
    fulfillment: await load("functions/_lib/order-fulfillment.mjs"),
    orders: await load("functions/_lib/orders-d1.mjs"),
    ownerAuth: await load("functions/_lib/owner-auth.mjs"),
    ownerOrders: await load("functions/_lib/owner-orders.mjs"),
    resendWebhook: await load("functions/_lib/resend-webhook.mjs"),
    stripeWebhook: await load("functions/_lib/stripe-webhook.mjs")
  };
  testMigration();
  await testOutboxAndProviderIdempotency(modules);
  await testVerifiedResendWebhooks(modules);
  await testOrderAccessAndDownloads(modules);
  await testOwnerControlsAndAudit(modules);
  await testDuplicateStripeDelivery(modules);
  console.log("Customer delivery, recovery, and owner control tests passed.");
}

function testMigration() {
  const { raw } = createDatabase();
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ["order_access_credentials", "email_outbox", "email_webhook_events", "owner_order_audit"]) {
    assert.ok(tables.includes(table), `${table} must exist.`);
  }
}

async function testOutboxAndProviderIdempotency(modules) {
  const fixture = await paidReadyFixture(modules);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ body: init.body, idempotencyKey: init.headers["idempotency-key"], url });
    return json({ id: "email_provider_one" }, 200);
  };
  const env = deliveryEnv(fixture.d1);
  let result = await modules.delivery.deliverPaidOrderEmail(fixture.d1, env, fixture.order.id, { fetchImpl, nowMs: NOW });
  assert.equal(result.outbox.status, "accepted");
  result = await modules.delivery.deliverPaidOrderEmail(fixture.d1, env, fixture.order.id, { fetchImpl, nowMs: NOW + 1000 });
  assert.equal(result.duplicate, true, "A repeated logical delivery must return the existing message.");
  assert.equal(calls.length, 1, "An accepted message must not be submitted twice.");
  assert.equal(await count(fixture.d1, "email_outbox"), 1);
  const access = await fixture.d1.prepare("SELECT * FROM order_access_credentials").first();
  assert.match(access.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.values(access).some((value) => String(value).startsWith("oa1.")), false, "The raw order-access credential must not be stored.");
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.from, "Tobacco Road Games <orders@tobaccoroadgames.com>");
  assert.equal(payload.reply_to, "support@example.com");
  assert.match(payload.text, /TRG-DELIVERY-/);
  assert.match(payload.text, /Agency/);
  assert.match(payload.text, /\$4\.00/);
  assert.match(payload.html, /Access your downloads/);
  assert.doesNotMatch(payload.html, /<img|tracking|marketing/i);

  const retryFixture = await paidReadyFixture(modules);
  const retryCalls = [];
  let failFirst = true;
  const retryFetch = async (url, init) => {
    retryCalls.push({ body: init.body, key: init.headers["idempotency-key"] });
    if (failFirst) {
      failFirst = false;
      return json({ name: "internal_server_error" }, 500);
    }
    return json({ id: "email_provider_retry_same_message" }, 200);
  };
  result = await modules.delivery.deliverPaidOrderEmail(retryFixture.d1, deliveryEnv(retryFixture.d1), retryFixture.order.id, { fetchImpl: retryFetch, nowMs: NOW });
  assert.equal(result.retryable, true);
  assert.equal(result.outbox.status, "delayed");
  result = await modules.delivery.deliverPaidOrderEmail(retryFixture.d1, deliveryEnv(retryFixture.d1), retryFixture.order.id, { fetchImpl: retryFetch, nowMs: NOW + 1000 });
  assert.equal(result.outbox.status, "accepted");
  assert.equal(retryCalls.length, 2);
  assert.equal(retryCalls[0].key, retryCalls[1].key, "Retries must reuse the provider idempotency key.");
  assert.equal(retryCalls[0].body, retryCalls[1].body, "Retries must reuse the exact provider payload.");
  assert.equal(await count(retryFixture.d1, "email_outbox"), 1);

  const expiredFixture = await paidReadyFixture(modules);
  let expiredCalls = 0;
  const indeterminateFetch = async () => { expiredCalls += 1; throw new Error("connection lost"); };
  result = await modules.delivery.deliverPaidOrderEmail(expiredFixture.d1, deliveryEnv(expiredFixture.d1), expiredFixture.order.id, { fetchImpl: indeterminateFetch, nowMs: NOW });
  assert.equal(result.retryable, true);
  result = await modules.delivery.deliverPaidOrderEmail(expiredFixture.d1, deliveryEnv(expiredFixture.d1), expiredFixture.order.id, { fetchImpl: indeterminateFetch, nowMs: NOW + 23 * 60 * 60 * 1000 });
  assert.equal(result.outbox.status, "failed");
  assert.equal(result.errorCode, "provider_idempotency_window_expired");
  assert.equal(expiredCalls, 1, "Automatic retry must stop before the provider idempotency window expires.");
}

async function testVerifiedResendWebhooks(modules) {
  const fixture = await paidReadyFixture(modules);
  await modules.delivery.deliverPaidOrderEmail(fixture.d1, deliveryEnv(fixture.d1), fixture.order.id, {
    fetchImpl: async () => json({ id: "email_for_webhook" }, 200), nowMs: NOW
  });
  const delivered = resendEvent("email.delivered", "email_for_webhook");
  let response = await sendResendWebhook(modules.resendWebhook, fixture.d1, delivered, { badSignature: true });
  assert.equal(response.status, 400);
  assert.equal(await count(fixture.d1, "email_webhook_events"), 0, "Unverified Resend payloads must not be recorded.");
  response = await sendResendWebhook(modules.resendWebhook, fixture.d1, delivered);
  assert.equal(response.status, 200);
  response = await sendResendWebhook(modules.resendWebhook, fixture.d1, delivered);
  assert.equal(response.status, 200, "Duplicate verified webhooks must be accepted as no-ops.");
  assert.equal(await count(fixture.d1, "email_webhook_events"), 1);
  assert.equal((await fixture.d1.prepare("SELECT status FROM email_outbox").first()).status, "delivered");
  const sentAfterDelivered = resendEvent("email.sent", "email_for_webhook");
  response = await sendResendWebhook(modules.resendWebhook, fixture.d1, sentAfterDelivered);
  assert.equal(response.status, 200);
  assert.equal((await fixture.d1.prepare("SELECT status FROM email_outbox").first()).status, "delivered", "Out-of-order sent events must not regress a delivered message.");
  assert.equal((await fixture.d1.prepare("SELECT email_status FROM orders").first()).email_status, "sent");

  for (const [eventType, expectedStatus] of [["email.delivery_delayed", "delayed"], ["email.failed", "failed"], ["email.bounced", "bounced"], ["email.suppressed", "suppressed"]]) {
    const stateFixture = await paidReadyFixture(modules);
    const providerId = `email_${expectedStatus}`;
    await modules.delivery.deliverPaidOrderEmail(stateFixture.d1, deliveryEnv(stateFixture.d1), stateFixture.order.id, {
      fetchImpl: async () => json({ id: providerId }, 200), nowMs: NOW
    });
    response = await sendResendWebhook(modules.resendWebhook, stateFixture.d1, resendEvent(eventType, providerId));
    assert.equal(response.status, 200);
    assert.equal((await stateFixture.d1.prepare("SELECT status FROM email_outbox").first()).status, expectedStatus);
  }
}

async function testOrderAccessAndDownloads(modules) {
  const fixture = await paidReadyFixture(modules);
  const access = await modules.access.ensureActiveOrderAccessCredential(fixture.d1, fixture.order, ACCESS_SECRET, { nowMs: NOW });
  const env = { ...deliveryEnv(fixture.d1), DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET };
  let response = await modules.accessPage.handleOrderAccessPage(
    new Request(`https://staging.example/store/order-access?credential=${encodeURIComponent(access.token)}`), env, { nowMs: NOW }
  );
  assert.equal(response.status, 200, "The emailed link must work without a checkout cookie.");
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  assert.match(html, /Download Agency\.pdf/);
  const match = html.match(/\/store\/download\?credential=([^"&]+)/);
  assert.ok(match);
  response = await modules.download.handleAuthorizedDownload(
    new Request(`https://staging.example/store/download?credential=${match[1]}`),
    { DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET, TRG_ORDERS: fixture.d1, TRG_PRODUCTS: bucket() },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.length, PDF.length);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "%PDF-1.7");

  const altered = `${access.token.slice(0, -1)}${access.token.endsWith("A") ? "B" : "A"}`;
  response = await modules.accessPage.handleOrderAccessPage(new Request(`https://staging.example/store/order-access?credential=${altered}`), env, { nowMs: NOW });
  assert.equal(response.status, 403);
  await modules.access.revokeOrderAccessCredentials(fixture.d1, fixture.order.id, { nowMs: NOW + 2000 });
  response = await modules.accessPage.handleOrderAccessPage(new Request(`https://staging.example/store/order-access?credential=${encodeURIComponent(access.token)}`), env, { nowMs: NOW + 3000 });
  assert.equal(response.status, 403, "Revoked order access must remain blocked.");
}

async function testOwnerControlsAndAudit(modules) {
  const fixture = await paidReadyFixture(modules);
  const env = { ...deliveryEnv(fixture.d1), DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET, OWNER_CSRF_SECRET: "owner-csrf-secret-long-enough", OWNER_SESSION_SECRET: "owner-session-secret-long-enough", TRG_PRODUCTS: bucket() };
  await modules.delivery.deliverPaidOrderEmail(fixture.d1, env, fixture.order.id, { fetchImpl: async () => json({ id: "owner_initial" }, 200), nowMs: NOW });
  const session = await modules.ownerAuth.createSessionToken("rv", env.OWNER_SESSION_SECRET, NOW);
  const csrf = await modules.ownerAuth.createCsrfToken("rv", env.OWNER_CSRF_SECRET, NOW);
  const cookie = `trg_owner_session=${session}; trg_owner_csrf=${csrf}`;
  let response = await modules.ownerOrders.handleOwnerOrdersRequest(new Request(`https://staging.example/owner/api/orders?query=${fixture.order.public_id}`, { headers: { cookie } }), env, { nowMs: NOW });
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.orders[0].publicId, fixture.order.public_id);
  assert.equal(body.orders[0].paymentStatus, "paid");
  assert.equal(body.orders[0].entitlements.length, 1);

  const ownerFetch = async () => json({ id: "owner_intentional_resend" }, 200);
  response = await ownerMutation(modules.ownerOrders, env, cookie, csrf, fixture.order.public_id, "resend_delivery", { fetchImpl: ownerFetch });
  assert.equal(response.status, 200);
  assert.equal(await count(fixture.d1, "email_outbox"), 2, "An intentional owner resend creates exactly one new logical message.");
  response = await ownerMutation(modules.ownerOrders, env, cookie, csrf, fixture.order.public_id, "repair_fulfillment");
  assert.equal(response.status, 200);
  response = await ownerMutation(modules.ownerOrders, env, cookie, csrf, fixture.order.public_id, "revoke_access");
  assert.equal(response.status, 200);
  response = await ownerMutation(modules.ownerOrders, env, cookie, csrf, fixture.order.public_id, "regenerate_access");
  assert.equal(response.status, 200);
  assert.ok(await count(fixture.d1, "owner_order_audit") >= 5, "Lookups and owner mutations must be audited.");

  const unpaid = await orderFixture(modules.orders, false);
  const unpaidEnv = { ...env, TRG_ORDERS: unpaid.d1 };
  response = await ownerMutation(modules.ownerOrders, unpaidEnv, cookie, csrf, unpaid.order.public_id, "repair_fulfillment");
  assert.equal(response.status, 409, "Owner repair must reject an unpaid order.");
  assert.equal(await count(unpaid.d1, "download_entitlements"), 0);
  assert.equal((await unpaid.d1.prepare("SELECT outcome FROM owner_order_audit").first()).outcome, "rejected");
}

async function testDuplicateStripeDelivery(modules) {
  const fixture = await orderFixture(modules.orders, false);
  const event = stripeEvent(fixture.order);
  let providerCalls = 0;
  const env = {
    ...deliveryEnv(fixture.d1),
    PAYMENT_PIPELINE_STAGE: "staging",
    RESEND_DELIVERY_ENABLED: "true",
    STRIPE_WEBHOOK_SECRET: "whsec_stripe_delivery_test",
    TRG_PRODUCTS: bucket()
  };
  const send = async () => {
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(NOW / 1000);
    const signature = await stripeSignature(raw, env.STRIPE_WEBHOOK_SECRET, timestamp);
    return modules.stripeWebhook.handleStripeWebhookRequest(new Request("https://staging.example/api/stripe/webhook", {
      body: raw, headers: { "stripe-signature": signature }, method: "POST"
    }), env, {
      deliveryFetchImpl: async () => { providerCalls += 1; return json({ id: "stripe_delivery_email" }, 200); },
      nowMs: NOW
    });
  };
  let response = await send();
  assert.equal(response.status, 200);
  response = await send();
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1, "Duplicate Stripe delivery must not create a duplicate provider message.");
  assert.equal(await count(fixture.d1, "email_outbox"), 1);
  assert.equal(await count(fixture.d1, "download_entitlements"), 1);
  assert.equal(await count(fixture.d1, "webhook_events"), 1);
}

async function paidReadyFixture(modules) {
  const fixture = await orderFixture(modules.orders, true);
  const repaired = await modules.fulfillment.repairPaidOrderFulfillment(fixture.d1, bucket(), fixture.order.id, { nowMs: NOW });
  assert.equal(repaired.ready, true);
  fixture.order = repaired.order;
  return fixture;
}

async function orderFixture(orders, paid) {
  sequence += 1;
  const { d1 } = createDatabase();
  const suffix = String(sequence).padStart(4, "0");
  let order = await orders.createPendingOrder(d1, {
    checkoutAttemptId: `trgca_10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    checkoutRequestHash: String(sequence).padStart(64, "0"), currency: "USD",
    customerEmail: "buyer@example.com", customerEmailHash: `hash-${suffix}`,
    customerEmailNormalized: "buyer@example.com", publicId: `TRG-DELIVERY-${suffix}`,
    subtotalCents: 400, totalCents: 400
  }, [{ authorSlugsJson: '["rv-sawyer"]', currency: "USD", effectiveUnitPriceCents: 400, lastUpdatedSnapshot: "2026-07-01", lineTotalCents: 400, listPriceCents: 400, primaryAuthorSlug: "rv-sawyer", productSlug: "agency", productTitleSnapshot: "Agency", quantity: 1, versionSnapshot: "1.0" }]);
  order = await orders.attachStripeCheckoutSession(d1, order.id, { id: `cs_test_delivery_${suffix}`, url: `https://checkout.stripe.com/${suffix}` }, { updatedAt: new Date(NOW).toISOString() });
  if (paid) {
    order = await orders.updateOrderPaymentStatus(d1, order.id, { paidAt: new Date(NOW).toISOString(), paymentStatus: "paid", stripePaymentIntentId: `pi_test_delivery_${suffix}` });
  }
  return { d1, order };
}

function deliveryEnv(d1) {
  return { ORDER_ACCESS_SIGNING_SECRET: ACCESS_SECRET, PUBLIC_SITE_ORIGIN: "https://staging.example", RESEND_API_KEY: "re_test_delivery", RESEND_REPLY_TO: "support@example.com", TRG_ORDERS: d1 };
}

function bucket() {
  return { async get(key) { return key === "agency/product.pdf" ? { body: PDF, size: PDF.length } : null; }, async head(key) { return key === "agency/product.pdf" ? { size: PDF.length } : null; } };
}

function resendEvent(type, emailId) {
  sequence += 1;
  return { created_at: new Date(NOW).toISOString(), data: { email_id: emailId }, type, testId: sequence };
}

async function sendResendWebhook(webhook, d1, event, options = {}) {
  const raw = JSON.stringify(event); const timestamp = Math.floor(NOW / 1000); const id = `msg_test_${String(sequence).padStart(8, "0")}`;
  const signature = options.badSignature ? "v1,AAAA" : `v1,${await resendSignature(id, timestamp, raw)}`;
  return webhook.handleResendWebhookRequest(new Request("https://staging.example/api/resend/webhook", { body: raw, headers: { "svix-id": id, "svix-signature": signature, "svix-timestamp": String(timestamp) }, method: "POST" }), { RESEND_WEBHOOK_SECRET: RESEND_SECRET, TRG_ORDERS: d1 }, { nowMs: NOW });
}

async function ownerMutation(handler, env, cookie, csrf, publicOrderId, action, options = {}) {
  return handler.handleOwnerOrdersRequest(new Request("https://staging.example/owner/api/orders", { body: JSON.stringify({ action, publicOrderId }), headers: { "content-type": "application/json", cookie, origin: "https://staging.example", "x-csrf-token": csrf }, method: "POST" }), env, { fetchImpl: options.fetchImpl, nowMs: NOW });
}

function stripeEvent(order) {
  return { api_version: "2026-06-24.dahlia", created: Math.floor(NOW / 1000), data: { object: { amount_total: 400, currency: "usd", id: order.stripe_checkout_session_id, livemode: false, metadata: { trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id), trg_order_public_id: order.public_id }, object: "checkout.session", payment_intent: "pi_test_stripe_delivery", payment_status: "paid", ui_mode: "hosted_page" } }, id: "evt_test_delivery_duplicate", livemode: false, object: "event", type: "checkout.session.completed" };
}

async function stripeSignature(raw, secret, timestamp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const value = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`)));
  return `t=${timestamp},v1=${Buffer.from(value).toString("hex")}`;
}

async function resendSignature(id, timestamp, raw) {
  const keyBytes = Buffer.from(RESEND_SECRET.slice(6), "base64");
  const key = await crypto.subtle.importKey("raw", keyBytes, { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const value = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  return Buffer.from(value).toString("base64");
}

function createDatabase() {
  const raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON;"); for (const migration of MIGRATIONS) raw.exec(fs.readFileSync(migration, "utf8")); return { d1: adapter(raw), raw };
}

function adapter(raw) {
  return { async batch(statements) { raw.exec("BEGIN IMMEDIATE"); try { const results=[]; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch(error) { raw.exec("ROLLBACK"); throw error; } }, prepare(sql) { return prepared(raw.prepare(sql)); } };
}

function prepared(statement, values=[]) {
  return { all() { return Promise.resolve({ results: statement.all(...values) }); }, bind(...next) { return prepared(statement, next); }, first() { return Promise.resolve(statement.get(...values)||null); }, run() { const result=statement.run(...values); return Promise.resolve({ meta: { changes:Number(result.changes||0), last_row_id:Number(result.lastInsertRowid||0) } }); } };
}

async function count(d1, table) { return Number((await d1.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count); }
function json(body, status) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status }); }
function load(relative) { return import(pathToFileURL(path.join(ROOT, relative)).href); }

main().catch((error) => { console.error(error); process.exitCode = 1; });
