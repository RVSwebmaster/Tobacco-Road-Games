const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-30T14:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const EMAIL_SECRET = "task-2i-email-hash-secret";
const COOKIE_SECRET = "task-2i-cookie-secret";
const WEBHOOK_SECRET = "whsec_task2i_test_secret";
const API_VERSION = "2026-06-24.dahlia";
const BUYER = { id: "task2i-buyer", email: "buyer-task2i@example.test" };
let sequence = 0;

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const preparation = await load("functions/_lib/native-order-preparation.mjs");
  const payment = await load("functions/_lib/native-stripe-payment.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const entitlements = await load("functions/_lib/native-entitlements-d1.mjs");
  const transactionPolicy = await load("functions/_lib/transaction-policy.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
    VALUES(?,?,0,NULL,'active','user',?,?)`).run(BUYER.id, BUYER.email, ISO, ISO);

  const productBase = {
    creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 600, currency: "USD",
    coverR2Key: "catalog-publications/task2i/cover.webp",
    deliveryR2Key: "catalog-publications/task2i-fixed/delivery.pdf",
    deliveryFilename: "task2i.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "2.1" }
  };
  await catalog.createProduct(db, {
    ...productBase, id: "task2i-fixed", slug: "task2i-fixed", title: "Task 2I Fixed"
  }, { nowMs: NOW });
  await catalog.createProduct(db, {
    ...productBase, id: "task2i-pwyw", slug: "task2i-pwyw", title: "Task 2I PWYW",
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 900,
    minimumPriceCents: 300, suggestedPriceCents: 900,
    deliveryR2Key: "catalog-publications/task2i-pwyw/delivery.pdf",
    deliveryFilename: "task2i-pwyw.pdf", metadata: { ...productBase.metadata, version: "3.4" }
  }, { nowMs: NOW });
  await catalog.createProduct(db, {
    ...productBase, id: "task2i-unpaid", slug: "task2i-unpaid", title: "Task 2I Unpaid",
    deliveryR2Key: "catalog-publications/task2i-unpaid/delivery.pdf"
  }, { nowMs: NOW });
  await catalog.createProduct(db, {
    ...productBase, id: "task2i-recovery", slug: "task2i-recovery", title: "Task 2I Recovery",
    deliveryR2Key: "catalog-publications/task2i-recovery/delivery.pdf"
  }, { nowMs: NOW });

  const purchase = await prepareOrder(preparation, db, [
    { slug: "task2i-fixed", quantity: 1 },
    { slug: "task2i-pwyw", quantity: 1, amountCents: 725 }
  ]);
  const stripe = stripeHarness(`cs_test_task2i_${++sequence}`);
  let response = await payOrder(payment, db, purchase, stripe);
  assert.equal(response.status, 201);
  assert.equal(stripe.calls[0].form.get("line_items[0][price_data][unit_amount]"), "600");
  assert.equal(stripe.calls[0].form.get("line_items[1][price_data][unit_amount]"), "725");

  let order = orderByAttempt(raw, purchase.attempt);
  const event = stripeEvent(order, "evt_task2i_paid");
  response = await deliver(webhook, db, event);
  let body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.processingResult, "paid");
  assert.doesNotMatch(JSON.stringify(body), /private-delivery|private-pwyw|customer_email_hash|purchaser/i);
  order = orderByAttempt(raw, purchase.attempt);
  assert.equal(order.payment_status, "paid");
  assert.equal(order.native_order_state, "paid");
  assert.equal(order.native_entitlement_status, "ready");
  assert.equal(order.fulfillment_status, "ready", "The test bucket confirms delivery objects are present before entitlements become usable.");

  let owned = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=? ORDER BY native_product_id").all(order.id);
  assert.equal(owned.length, 2, "One ownership entitlement is required for each purchased native product.");
  assert.deepEqual(owned.map(row => row.native_product_id), ["task2i-fixed", "task2i-pwyw"]);
  for (const row of owned) {
    assert.equal(row.purchaser_user_id, BUYER.id);
    assert.equal(row.purchaser_email_hash_snapshot, order.customer_email_hash);
    assert.equal(row.native_creator_id, "creator-rv-sawyer");
    assert.equal(row.catalog_revision_snapshot, 1);
    assert.equal(row.entitlement_source, "stripe_paid");
    assert.equal(row.status, "active");
  }
  assert.equal(owned.find(row => row.native_product_id === "task2i-fixed").version_snapshot, "2.1");
  assert.equal(owned.find(row => row.native_product_id === "task2i-fixed").selected_price_cents_snapshot, 600);
  assert.equal(owned.find(row => row.native_product_id === "task2i-pwyw").version_snapshot, "3.4");
  assert.equal(owned.find(row => row.native_product_id === "task2i-pwyw").selected_price_cents_snapshot, 725);
  assert.deepEqual((await transactionPolicy.findDuplicateDigitalOwnership(db, {
    emailHash: order.customer_email_hash,
    productSlugs: ["task2i-fixed", "task2i-pwyw"],
    userId: BUYER.id
  })).sort(), ["task2i-fixed", "task2i-pwyw"], "Native ownership must participate in duplicate-purchase protection.");
  assert.equal(count(raw, "download_entitlements"), 0, "Task 2I must not create delivery-capable entitlements.");
  const nativeColumns = raw.prepare("PRAGMA table_info(native_product_entitlements)").all().map(row => row.name);
  assert.equal(nativeColumns.some(name => /r2|delivery|filename|content_type/i.test(name)), false, "Ownership rows must not contain private delivery references.");

  response = await deliver(webhook, db, event);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(order.id).n, 2);

  let fixed = await catalog.getProductById(db, "task2i-fixed");
  await catalog.updateProduct(db, fixed.id, { priceCents: 1200, publicationState: "paused" }, {
    expectedRevision: fixed.revision, nowMs: NOW + 1000
  });
  let pwyw = await catalog.getProductById(db, "task2i-pwyw");
  await catalog.updateProduct(db, pwyw.id, { publicationState: "draft" }, {
    expectedRevision: pwyw.revision, nowMs: NOW + 2000
  });
  owned = raw.prepare("SELECT * FROM native_product_entitlements WHERE order_id=? ORDER BY native_product_id").all(order.id);
  assert.equal(owned.length, 2, "Repricing, pausing, and unpublishing cannot remove ownership.");
  assert.equal(owned.find(row => row.native_product_id === "task2i-fixed").selected_price_cents_snapshot, 600);
  assert.equal(owned.find(row => row.native_product_id === "task2i-fixed").catalog_revision_snapshot, 1);

  const unpaid = await prepareOrder(preparation, db, [{ slug: "task2i-unpaid", quantity: 1 }]);
  let grant = await entitlements.grantNativePaidOrderEntitlements(db, unpaid.order.id, { nowMs: NOW });
  assert.equal(grant.result, "order_not_paid");
  raw.prepare("UPDATE orders SET payment_status='expired',native_order_state='canceled',fulfillment_status='canceled' WHERE id=?").run(unpaid.order.id);
  grant = await entitlements.grantNativePaidOrderEntitlements(db, unpaid.order.id, { nowMs: NOW });
  assert.equal(grant.result, "order_not_paid");

  const failed = seedNativeFailedOrder(raw, order, "TRG-TASK2I-FAILED");
  grant = await entitlements.grantNativePaidOrderEntitlements(db, failed, { nowMs: NOW });
  assert.equal(grant.result, "order_not_paid");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id IN (?,?)").get(unpaid.order.id, failed).n, 0);

  const recovery = await prepareOrder(preparation, db, [{ slug: "task2i-recovery", quantity: 1 }]);
  await payOrder(payment, db, recovery, stripeHarness(`cs_test_task2i_recovery_${++sequence}`));
  const recoveryOrder = orderByAttempt(raw, recovery.attempt);
  const recoveryEvent = stripeEvent(recoveryOrder, "evt_task2i_recovery");
  response = await deliver(webhook, failNextEntitlementBatch(db), recoveryEvent);
  body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.code, "native_entitlement_processing_failed");
  order = orderByAttempt(raw, recovery.attempt);
  assert.equal(order.payment_status, "paid", "Entitlement failure must never roll back or obscure successful payment.");
  assert.equal(order.native_entitlement_status, "failed");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(order.id).n, 0);
  assert.equal(raw.prepare("SELECT processing_status FROM webhook_events WHERE provider_event_id=?").get(recoveryEvent.id).processing_status, "processed");

  response = await deliver(webhook, db, recoveryEvent);
  body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.duplicate, true);
  order = orderByAttempt(raw, recovery.attempt);
  assert.equal(order.native_entitlement_status, "ready");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(order.id).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM webhook_events WHERE provider_event_id=?").get(recoveryEvent.id).n, 1);

  const legacy = seedLegacyEntitlement(raw);
  grant = await entitlements.grantNativePaidOrderEntitlements(db, legacy.orderId, { nowMs: NOW });
  assert.equal(grant.result, "not_native_order");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements WHERE id=?").get(legacy.entitlementId).n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_product_entitlements WHERE order_id=?").get(legacy.orderId).n, 0);

  raw.close();
  console.log("Native D1 paid-purchase entitlement tests passed.");
}

async function prepareOrder(preparation, db, items) {
  sequence += 1;
  const attempt = `trgca_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  const response = await preparation.handleNativeOrderPreparationRequest(new Request("https://example.test/api/cart/prepare-order", {
    method: "POST", body: JSON.stringify({
      checkoutAttemptId: attempt, email: BUYER.email, emailConfirmation: BUYER.email, items
    })
  }), { ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, TRG_ORDERS: db }, {
    accountSession: { valid: true, user: { email: BUYER.email, email_verified: 0, id: BUYER.id, role: "user", status: "active" } }, includeNative: true, now: NOW,
    publicIdGenerator: () => `TRG-TASK2I-${String(sequence).padStart(4, "0")}`,
    skipIdentityChecks: false
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return { attempt, order: await db.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").bind(attempt).first(), publicId: body.publicOrderReference };
}

function payOrder(payment, db, fixture, stripe) {
  return payment.handleNativeStripePaymentRequest(new Request("https://example.test/api/cart/pay-order", {
    method: "POST", body: JSON.stringify({
      checkoutAttemptId: fixture.attempt, publicOrderReference: fixture.publicId,
      email: BUYER.email, emailConfirmation: BUYER.email
    })
  }), {
    CHECKOUT_ACCESS_COOKIE_SECRET: COOKIE_SECRET, ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET,
    PAYMENT_PIPELINE_STAGE: "staging", STRIPE_SECRET_KEY: "sk_test_task2i", TRG_ORDERS: db
  }, {
    accountSession: { valid: true, user: { email: BUYER.email, email_verified: 0, id: BUYER.id, role: "user", status: "active" } }, now: NOW,
    skipIdentityChecks: false, stripeFetchImpl: stripe.fetch
  });
}

function stripeHarness(id) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      const form = new URLSearchParams(String(options.body || ""));
      calls.push({ form, url: String(url) });
      return response({ id, livemode: false, ui_mode: "hosted_page", url: `https://checkout.stripe.test/${id}` });
    }
  };
}

function stripeEvent(order, id) {
  return {
    api_version: API_VERSION, created: Math.floor(NOW / 1000), id, livemode: false, object: "event",
    type: "checkout.session.completed", data: { object: {
      amount_total: Number(order.total_cents), currency: String(order.currency).toLowerCase(),
      id: order.stripe_checkout_session_id, livemode: false, object: "checkout.session",
      metadata: {
        trg_checkout_attempt_id: order.checkout_attempt_id, trg_order_id: String(order.id),
        trg_order_public_id: order.public_id, trg_order_source: "native_d1"
      },
      payment_intent: `pi_${id}`, payment_status: "paid", ui_mode: "hosted_page"
    } }
  };
}

async function deliver(webhook, db, event) {
  const body = JSON.stringify(event);
  return webhook.handleStripeWebhookRequest(new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": await signature(body) }, body
  }), { PAYMENT_PIPELINE_STAGE: "staging", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TRG_ORDERS: db, TRG_PRODUCTS: { head: async () => ({}) } }, { nowMs: NOW });
}

async function signature(body) {
  const timestamp = Math.floor(NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${Buffer.from(new Uint8Array(signed)).toString("hex")}`;
}

function seedNativeFailedOrder(raw, source, publicId) {
  const result = raw.prepare(`INSERT INTO orders(
    public_id,user_id,customer_email,customer_email_normalized,customer_email_hash,currency,
    subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,
    payment_source,settlement_method,catalog_source,native_order_state,native_prepared_at,
    native_payment_expires_at,native_entitlement_status)
    VALUES(?,?,?,?,?,?,?,?,'failed','canceled','pending',?,'none','no_payment','native_d1','failed',?,?,'pending')`)
    .run(publicId, source.user_id, source.customer_email, source.customer_email_normalized,
      source.customer_email_hash, source.currency, source.subtotal_cents, source.total_cents,
      ISO, ISO, new Date(NOW + 3600000).toISOString());
  return Number(result.lastInsertRowid);
}

function seedLegacyEntitlement(raw) {
  const orderId = Number(raw.prepare(`INSERT INTO orders(public_id,user_id,customer_email,customer_email_normalized,
    customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at)
    VALUES('TRG-TASK2I-LEGACY',?,'legacy@example.test','legacy@example.test','legacy-hash','USD',100,100,'paid','ready','pending',?)`)
    .run(BUYER.id, ISO).lastInsertRowid);
  const itemId = Number(raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,
    primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,
    currency,version_snapshot,last_updated_snapshot,created_at)
    VALUES(?,'legacy-task2i','Legacy Task 2I','legacy','[]',1,100,100,100,'USD','1','2026-01-01',?)`)
    .run(orderId, ISO).lastInsertRowid);
  const entitlementId = Number(raw.prepare(`INSERT INTO download_entitlements(order_id,order_item_id,product_slug,
    r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at)
    VALUES(?,?,'legacy-task2i','legacy/private.pdf','Legacy.pdf','application/pdf',10,'active',?)`)
    .run(orderId, itemId, ISO).lastInsertRowid);
  return { entitlementId, orderId };
}

function failNextEntitlementBatch(db) {
  let fail = true;
  return {
    prepare: db.prepare.bind(db),
    async batch(statements) {
      if (fail && statements.some(statement => String(statement._sql || "").includes("native_product_entitlements"))) {
        fail = false;
        throw new Error("Injected native entitlement batch failure.");
      }
      return db.batch(statements);
    }
  };
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
        _sql: sql,
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() {
          const result = raw.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        }
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
