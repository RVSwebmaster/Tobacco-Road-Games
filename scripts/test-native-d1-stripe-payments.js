const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-29T22:00:00.000Z");
const EMAIL_SECRET = "task-2h-email-hash";
const COOKIE_SECRET = "task-2h-cookie-secret";
const WEBHOOK_SECRET = "whsec_task2h_test_secret";
const API_VERSION = "2026-06-24.dahlia";
let sequence = 0;

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const preparation = await load("functions/_lib/native-order-preparation.mjs");
  const payment = await load("functions/_lib/native-stripe-payment.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  const base = {
    creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500, currency: "USD",
    coverR2Key: "catalog-publications/task2h/cover.webp",
    deliveryR2Key: "catalog-publications/task2h/delivery.pdf",
    deliveryFilename: "task2h.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  };
  await catalog.createProduct(db, { ...base, id: "task2h-fixed", slug: "task2h-fixed", title: "Task 2H Fixed" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2h-pwyw", slug: "task2h-pwyw", title: "Task 2H PWYW",
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 700,
    minimumPriceCents: 250, suggestedPriceCents: 700 }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2h-stale", slug: "task2h-stale", title: "Task 2H Stale" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2h-paused", slug: "task2h-paused", title: "Task 2H Paused" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2h-free", slug: "task2h-free", title: "Task 2H Free",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0 }, { nowMs: NOW });

  const fixed = await prepareOrder(preparation, db, "task2h-fixed", undefined);
  const fixedStripe = stripeHarness("cs_test_task2h_fixed");
  let response = await payOrder(payment, db, fixed, fixedStripe, { priceCents: 1, amountCents: 1 });
  let body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.totalCents, 500);
  assert.equal(fixedStripe.calls.length, 1);
  const fixedForm = fixedStripe.calls[0].form;
  assert.equal(fixedForm.get("line_items[0][price_data][unit_amount]"), "500", "Stripe must receive the immutable fixed-price snapshot.");
  assert.equal(fixedForm.get("metadata[trg_order_source]"), "native_d1");
  assert.equal(fixedForm.get("payment_intent_data[metadata][trg_order_source]"), "native_d1");
  assert.equal(fixedForm.get("metadata[trg_order_id]"), String(fixed.order.id));
  assert.equal(fixedForm.get("client_reference_id"), fixed.order.public_id);
  assert.ok(Number(fixedForm.get("expires_at")) > Math.floor(NOW / 1000));
  let storedOrder = orderByAttempt(raw, fixed.attempt);
  assert.equal(storedOrder.payment_status, "pending");
  assert.equal(storedOrder.native_order_state, "pending");
  assert.equal(storedOrder.payment_source, "stripe");

  response = await payOrder(payment, db, fixed, fixedStripe);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reusedCheckoutAttempt, true);
  assert.equal(fixedStripe.calls.length, 1, "A repeated payment request must reuse the attached Stripe Session.");

  let event = stripeEvent(storedOrder, { id: "evt_task2h_fixed_paid" });
  let rawBody = JSON.stringify(event);
  response = await webhook.handleStripeWebhookRequest(webhookRequest(rawBody, `t=${Math.floor(NOW / 1000)},v1=${"0".repeat(64)}`), webhookEnv(db), { nowMs: NOW });
  assert.equal(response.status, 400, "An invalid signature must be rejected before event persistence.");
  assert.equal(count(raw, "webhook_events"), 0);
  assert.equal(orderByAttempt(raw, fixed.attempt).payment_status, "pending");

  response = await deliver(webhook, db, event);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.processingResult, "paid");
  storedOrder = orderByAttempt(raw, fixed.attempt);
  assert.equal(storedOrder.payment_status, "paid");
  assert.equal(storedOrder.native_order_state, "paid");
  assert.equal(storedOrder.fulfillment_status, "pending", "Native payment must not activate fulfillment.");
  assert.equal(count(raw, "download_entitlements"), 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_sale_snapshots WHERE order_id=?").get(storedOrder.id).n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_earnings_ledger WHERE order_id=?").get(storedOrder.id).n, 0);

  response = await deliver(webhook, db, event);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM webhook_events WHERE provider_event_id='evt_task2h_fixed_paid'").get().n, 1);
  response = await deliver(webhook, db, stripeEvent(storedOrder, {
    id: "evt_task2h_fixed_late_expired", paymentIntent: storedOrder.stripe_payment_intent_id,
    paymentStatus: "unpaid", type: "checkout.session.expired"
  }));
  assert.equal(response.status, 200);
  assert.equal(orderByAttempt(raw, fixed.attempt).payment_status, "paid", "A late expiration must not overwrite a paid order.");
  response = await payOrder(payment, db, fixed, fixedStripe);
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_order_already_paid");

  const pwyw = await prepareOrder(preparation, db, "task2h-pwyw", 525);
  const pwywStripe = stripeHarness("cs_test_task2h_pwyw");
  response = await payOrder(payment, db, pwyw, pwywStripe, { amountCents: 1, priceCents: 1 });
  assert.equal(response.status, 201);
  assert.equal(pwywStripe.calls[0].form.get("line_items[0][price_data][unit_amount]"), "525");
  storedOrder = orderByAttempt(raw, pwyw.attempt);
  event = stripeEvent(storedOrder, { amountTotal: 526, id: "evt_task2h_wrong_amount" });
  response = await deliver(webhook, db, event);
  body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "amount_total_mismatch");
  assert.equal(orderByAttempt(raw, pwyw.attempt).payment_status, "pending");
  event = stripeEvent(storedOrder, { currency: "cad", id: "evt_task2h_wrong_currency" });
  response = await deliver(webhook, db, event);
  body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "currency_mismatch");
  assert.equal(orderByAttempt(raw, pwyw.attempt).payment_status, "pending");
  event = stripeEvent(storedOrder, { id: "evt_task2h_pwyw_paid" });
  response = await deliver(webhook, db, event);
  assert.equal(response.status, 200);
  assert.equal(orderByAttempt(raw, pwyw.attempt).payment_status, "paid");
  assert.equal(count(raw, "download_entitlements"), 0);

  const stale = await prepareOrder(preparation, db, "task2h-stale", undefined);
  const staleProduct = await catalog.getProductById(db, "task2h-stale");
  await catalog.updateProduct(db, staleProduct.id, { priceCents: 650 }, { expectedRevision: staleProduct.revision, nowMs: NOW + 1000 });
  const staleStripe = stripeHarness("cs_test_task2h_stale");
  response = await payOrder(payment, db, stale, staleStripe);
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_catalog_revision_stale");
  assert.equal(staleStripe.calls.length, 0);
  assert.equal(orderByAttempt(raw, stale.attempt).native_order_state, "canceled");

  const paused = await prepareOrder(preparation, db, "task2h-paused", undefined);
  const pausedProduct = await catalog.getProductById(db, "task2h-paused");
  await catalog.updateProduct(db, pausedProduct.id, { publicationState: "paused" }, { expectedRevision: pausedProduct.revision, nowMs: NOW + 1000 });
  response = await payOrder(payment, db, paused, stripeHarness("cs_test_task2h_paused"));
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_catalog_revision_stale");
  assert.equal(orderByAttempt(raw, paused.attempt).native_order_state, "canceled");

  const free = await prepareOrder(preparation, db, "task2h-free", undefined);
  const freeStripe = stripeHarness("cs_test_task2h_free");
  response = await payOrder(payment, db, free, freeStripe);
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_free_payment_unavailable");
  assert.equal(freeStripe.calls.length, 0);
  assert.equal(orderByAttempt(raw, free.attempt).payment_status, "pending");

  const expired = await prepareOrder(preparation, db, "task2h-fixed", undefined);
  raw.prepare("UPDATE orders SET native_payment_expires_at=? WHERE checkout_attempt_id=?").run(new Date(NOW - 1000).toISOString(), expired.attempt);
  response = await payOrder(payment, db, expired, stripeHarness("cs_test_task2h_expired"));
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "native_order_expired");
  assert.equal(orderByAttempt(raw, expired.attempt).native_order_state, "canceled");

  const production = await prepareOrder(preparation, db, "task2h-fixed", undefined);
  let productionCalled = false;
  response = await payOrder(payment, db, production, {
    calls: [], fetch: async () => { productionCalled = true; throw new Error("must not call"); }
  }, {}, { pipelineStage: "production", stripeSecretKey: "sk_live_forbidden" });
  assert.equal(response.status, 503);
  assert.equal(productionCalled, false);

  assert.ok(JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8")).include.includes("/api/cart/pay-order"));
  assert.equal(count(raw, "download_entitlements"), 0, "Native payment must not create a delivery-capable entitlement.");
  raw.close();
  console.log("Native D1 Stripe payment tests passed.");
}

async function prepareOrder(preparation, db, slug, amountCents) {
  sequence += 1;
  const attempt = `trgca_2${String(sequence).padStart(7, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const items = [{ slug, quantity: 1 }];
  if (amountCents !== undefined) items[0].amountCents = amountCents;
  const response = await preparation.handleNativeOrderPreparationRequest(new Request("https://example.test/api/cart/prepare-order", {
    method: "POST", body: JSON.stringify({
      checkoutAttemptId: attempt, email: "buyer@example.test", emailConfirmation: "buyer@example.test", items
    })
  }), { ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, TRG_ORDERS: db }, {
    accountSession: null, includeNative: true, now: NOW,
    publicIdGenerator: () => `TRG-TASK2H-${String(sequence).padStart(4, "0")}`,
    skipIdentityChecks: true
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return { attempt, order: await db.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").bind(attempt).first(), publicId: body.publicOrderReference };
}

function payOrder(payment, db, fixture, stripe, forged = {}, overrides = {}) {
  return payment.handleNativeStripePaymentRequest(new Request("https://example.test/api/cart/pay-order", {
    method: "POST", body: JSON.stringify({
      checkoutAttemptId: fixture.attempt, publicOrderReference: fixture.publicId,
      email: "buyer@example.test", emailConfirmation: "buyer@example.test", ...forged
    })
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: COOKIE_SECRET, ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET,
    PAYMENT_PIPELINE_STAGE: "staging", STRIPE_SECRET_KEY: "sk_test_task2h", TRG_ORDERS: db
  }, {
    accountSession: null, now: NOW, skipIdentityChecks: true, stripeFetchImpl: stripe.fetch,
    ...overrides
  });
}

function stripeHarness(id) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      const form = new URLSearchParams(String(options.body || ""));
      calls.push({ form, headers: options.headers, url: String(url) });
      return response({ id, livemode: false, ui_mode: "hosted_page", url: `https://checkout.stripe.test/${id}` });
    }
  };
}

function stripeEvent(order, overrides = {}) {
  return {
    api_version: API_VERSION,
    created: Math.floor(NOW / 1000),
    data: { object: {
      amount_total: overrides.amountTotal ?? Number(order.total_cents),
      currency: overrides.currency || String(order.currency).toLowerCase(),
      id: order.stripe_checkout_session_id,
      livemode: false,
      metadata: {
        trg_checkout_attempt_id: order.checkout_attempt_id,
        trg_order_id: String(order.id),
        trg_order_public_id: order.public_id,
        trg_order_source: "native_d1"
      },
      object: "checkout.session",
      payment_intent: overrides.paymentIntent === undefined ? `pi_${overrides.id || "task2h"}` : overrides.paymentIntent,
      payment_status: overrides.paymentStatus || "paid",
      ui_mode: "hosted_page"
    } },
    id: overrides.id || `evt_task2h_${++sequence}`,
    livemode: false,
    object: "event",
    type: overrides.type || "checkout.session.completed"
  };
}

async function deliver(webhook, db, event) {
  const raw = JSON.stringify(event);
  return webhook.handleStripeWebhookRequest(webhookRequest(raw, await signature(raw)), webhookEnv(db), { nowMs: NOW });
}

function webhookEnv(db) {
  return { PAYMENT_PIPELINE_STAGE: "staging", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TRG_ORDERS: db };
}

function webhookRequest(body, stripeSignature) {
  return new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": stripeSignature }, body
  });
}

async function signature(body) {
  const timestamp = Math.floor(NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${Buffer.from(new Uint8Array(signed)).toString("hex")}`;
}

function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  return { raw, db: d1(raw) };
}

function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
      };
    },
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
    }
  };
}

function orderByAttempt(raw, attempt) { return raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(attempt); }
function count(raw, table) { return raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; }
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
