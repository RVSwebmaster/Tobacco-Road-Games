const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-11-18T16:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const WEBHOOK_SECRET = "whsec_c1_isolated_recovery_secret";
const DOWNLOAD_SECRET = "c1-isolated-download-signing-secret-long-enough";
const API_VERSION = "2026-06-24.dahlia";
const OLD_PDF = new TextEncoder().encode("%PDF-1.7\nPurchased edition one\n%%EOF\n");
const NEW_PDF = new TextEncoder().encode("%PDF-1.7\nCurrent edition two\n%%EOF\n");

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const nativeOrders = await load("functions/_lib/native-orders-d1.mjs");
  const nativeOwnership = await load("functions/_lib/native-entitlements-d1.mjs");
  const downloadAuth = await load("functions/_lib/download-authorization.mjs");
  const downloadRoute = await load("functions/_lib/download-route.mjs");
  const webhook = await load("functions/_lib/stripe-webhook.mjs");
  const ownerOrders = await load("functions/_lib/owner-orders.mjs");
  const ownerPage = fs.readFileSync(path.join(ROOT, "owner/orders.html"), "utf8");
  assert.match(ownerPage, /nativeEntitlementFailureCode/, "Owner order page must display native fulfillment failures.");
  const { raw, db } = createDatabase();
  const bucket = createBucket();

  raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
    VALUES('c1-buyer','c1-buyer@example.test',1,?,'active','user',?,?)`).run(ISO, ISO, ISO);
  const product = await catalog.createProduct(db, {
    id: "c1-native-product", slug: "c1-native-product", creatorId: "creator-rv-sawyer",
    title: "C1 Revisioned Product", status: "available-direct", buyMode: "cart",
    publicationState: "published", pricingModel: "fixed", priceCents: 700, currency: "USD",
    coverR2Key: "catalog-publications/c1-v1/cover.webp",
    deliveryR2Key: "catalog-publications/c1-v1/delivery.pdf",
    deliveryFilename: "C1 Purchased Edition One.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  }, { nowMs: NOW });
  bucket.objects.set(product.deliveryR2Key, OLD_PDF);

  const native = await createNativePaidOrder(nativeOrders, db, product);
  const updated = await catalog.updateProduct(db, product.id, {
    deliveryR2Key: "catalog-publications/c1-v2/delivery.pdf",
    deliveryFilename: "C1 Current Edition Two.pdf",
    priceCents: 900,
    metadata: { ...product.metadata, version: "2.0" }
  }, { expectedRevision: product.revision, nowMs: NOW + 1000 });
  bucket.objects.set(updated.deliveryR2Key, NEW_PDF);

  const event = paidEvent(native.order, "evt_c1_native_paid");
  let failEntitlementWrite = true;
  const flakyDb = {
    ...db,
    async batch(statements) {
      if (failEntitlementWrite && statements.some(statement => statement.sql?.includes("INSERT OR IGNORE INTO native_product_entitlements"))) {
        failEntitlementWrite = false;
        throw new Error("isolated entitlement write failure");
      }
      return db.batch(statements);
    }
  };
  let response = await deliverWebhook(webhook, flakyDb, event, bucket);
  assert.equal(response.status, 500, "Post-payment entitlement failure must remain retryable and visible as a failed webhook response.");
  const failedOrder = await getOrder(db, native.order.id);
  assert.equal(failedOrder.payment_status, "paid", "Successful Stripe payment must remain recorded after fulfillment fails.");
  assert.equal(failedOrder.native_order_state, "paid");
  assert.equal(failedOrder.native_entitlement_status, "failed");
  const failedEvent = await db.prepare("SELECT * FROM webhook_events WHERE provider_event_id=?").bind(event.id).first();
  assert.equal(failedEvent.processing_status, "processed", "Payment settlement/event receipt must remain durable while fulfillment awaits repair.");
  assert.equal(failedEvent.attempt_count, 1);

  response = await ownerOrders.handleOwnerOrdersRequest(new Request(
    `https://example.test/owner/api/orders?query=${encodeURIComponent(native.order.public_id)}`
  ), { TRG_ORDERS: db, TRG_PRODUCTS: bucket });
  assert.equal(response.status, 200);
  const ownerView = await response.json();
  assert.equal(ownerView.orders[0].nativeEntitlementStatus, "failed", "Owner order lookup must expose the failed entitlement state.");
  assert.equal(ownerView.orders[0].nativeEntitlementFailureCode, "native_entitlement_processing_failed");

  const ownerRepair = () => ownerOrders.handleOwnerOrdersRequest(new Request("https://example.test/owner/api/orders", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "repair_fulfillment", publicOrderId: native.order.public_id })
  }), { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, { nowMs: NOW + 2000 });
  response = await ownerRepair();
  assert.equal(response.status, 200, "Owner recovery must repair a paid native order without another Stripe charge.");
  let recovered = await response.json();
  assert.equal(recovered.order.nativeEntitlementStatus, "ready");
  assert.equal(recovered.order.fulfillmentStatus, "ready");
  response = await ownerRepair();
  assert.equal(response.status, 200, "A repeated Owner recovery should remain idempotently successful.");
  assert.equal(await count(db, "orders", "public_id", native.order.public_id), 1, "Repeated recovery must retain one order.");
  assert.equal(await count(db, "native_product_entitlements", "order_id", native.order.id), 1, "Repeated recovery must retain one native entitlement.");
  assert.equal((await getOrder(db, native.order.id)).stripe_payment_intent_id, "pi_c1_native_paid");

  response = await deliverWebhook(webhook, db, event, bucket);
  assert.equal(response.status, 200, "A duplicate webhook after Owner repair should receive success.");
  assert.equal((await response.json()).duplicate, true);
  assert.equal(await count(db, "orders", "public_id", native.order.public_id), 1);
  assert.equal(await count(db, "native_product_entitlements", "order_id", native.order.id), 1);
  assert.equal(await count(db, "webhook_events", "provider_event_id", event.id), 1);
  assert.equal((await db.prepare("SELECT attempt_count FROM webhook_events WHERE provider_event_id=?").bind(event.id).first()).attempt_count, 1,
    "Stripe redelivery of an already processed event must not re-settle payment or duplicate its event claim.");

  const nativeEntitlement = (await nativeOwnership.getNativeOrderEntitlements(db, native.order.id))[0];
  assert.equal(Number(nativeEntitlement.catalog_revision_snapshot), Number(native.item.catalog_revision));
  assert.equal(nativeEntitlement.product_slug_snapshot, native.item.product_slug);
  const credential = await downloadAuth.createNativeDownloadCredential(nativeEntitlement, DOWNLOAD_SECRET, { nowMs: NOW + 3000 });
  const downloadRequest = new Request(`https://example.test/store/download?credential=${encodeURIComponent(credential)}`);
  const delivered = await downloadRoute.handleAuthorizedDownload(downloadRequest, {
    TRG_ORDERS: db, TRG_PRODUCTS: bucket, DOWNLOAD_SIGNING_SECRET: DOWNLOAD_SECRET,
    PAYMENT_PIPELINE_STAGE: "production"
  }, { accountSession: { valid: true, user: { email_verified: 1, id: "c1-buyer" } }, nowMs: NOW + 3000 });
  assert.equal(delivered.status, 200, "Recovered native ownership must authorize the purchased asset.");
  assert.deepEqual(new Uint8Array(await delivered.arrayBuffer()), OLD_PDF, "Delivery must stream the exact PDF revision in the order snapshot.");
  assert.equal(bucket.requestedKeys.at(-1), native.item.delivery_r2_key_snapshot);
  assert.notEqual(bucket.requestedKeys.at(-1), updated.deliveryR2Key, "The current product PDF must not replace the purchased revision.");

  await testLegacyDuplicateEarnings(webhook, ownerOrders, db, bucket);
  raw.close();
  console.log("Paid-order fulfillment recovery tests passed.");
}

async function testLegacyDuplicateEarnings(webhook, ownerOrders, db, bucket) {
  const slug = "c1-legacy-earnings";
  const deliveryKey = "legacy-deliveries/c1-legacy-earnings.pdf";
  const deliveryBytes = new TextEncoder().encode("%PDF-1.7\nLegacy paid order\n%%EOF\n");
  bucket.objects.set(deliveryKey, deliveryBytes);
  await db.prepare(`INSERT INTO creator_listings(id,creator_id,slug,source_product_slug,title,lifecycle_state,publication_state,created_at,updated_at)
    VALUES('c1-legacy-listing','creator-rv-sawyer',?,?,?,'active','published',?,?)`)
    .bind(slug, slug, "C1 Legacy Earnings Product", ISO, ISO).run();
  const orders = await load("functions/_lib/orders-d1.mjs");
  const created = await orders.createPendingOrder(db, {
    checkoutAttemptId: "trgca_c1000000-0000-4000-8000-000000000001",
    checkoutRequestHash: "c".repeat(64), currency: "USD", customerEmail: "c1-buyer@example.test",
    customerEmailHash: "c1-buyer-hash", customerEmailNormalized: "c1-buyer@example.test",
    publicId: "TRG-C1-LEGACY-EARNINGS", subtotalCents: 500, totalCents: 500
  }, [{
    authorSlugsJson: JSON.stringify(["rv-sawyer"]), currency: "USD", effectiveUnitPriceCents: 500,
    lastUpdatedSnapshot: ISO, lineTotalCents: 500, listPriceCents: 500,
    primaryAuthorSlug: "rv-sawyer", productSlug: slug,
    productTitleSnapshot: "C1 Legacy Earnings Product", quantity: 1, versionSnapshot: "1.0"
  }]);
  const order = await orders.attachStripeCheckoutSession(db, Number(created.id), {
    id: "cs_test_c1_legacy", url: "https://checkout.stripe.test/c/pay/cs_test_c1_legacy"
  }, { updatedAt: ISO });
  const event = paidEvent(order, "evt_c1_legacy_paid", { includeNativeSource: false });
  const deliveryProducts = { [slug]: {
    contentType: "application/pdf", customerFilename: "C1 Legacy Earnings Product.pdf",
    productSlug: slug, r2ObjectKey: deliveryKey
  } };
  let response = await deliverWebhook(webhook, db, event, bucket, deliveryProducts);
  assert.equal(response.status, 200);
  const originalEarning = Number((await db.prepare(`SELECT SUM(amount_cents) amount FROM creator_earnings_ledger
    WHERE order_id=? AND entry_type='sale_earning'`).bind(order.id).first()).amount);
  assert.ok(originalEarning > 0);
  await deliverWebhook(webhook, db, event, bucket, deliveryProducts);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await ownerOrders.handleOwnerOrdersRequest(new Request("https://example.test/owner/api/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "repair_fulfillment", publicOrderId: order.public_id })
    }), { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, { deliveryProducts, nowMs: NOW + 5000 + attempt });
    assert.equal(response.status, 200);
  }
  assert.equal(await count(db, "orders", "public_id", order.public_id), 1);
  assert.equal(await count(db, "download_entitlements", "order_id", order.id), 1);
  assert.equal(await count(db, "creator_sale_snapshots", "order_id", order.id), 1);
  assert.equal(await count(db, "creator_earnings_ledger", "order_id", order.id, "sale_earning"), 1);
  const finalEarning = Number((await db.prepare(`SELECT SUM(amount_cents) amount FROM creator_earnings_ledger
    WHERE order_id=? AND entry_type='sale_earning'`).bind(order.id).first()).amount);
  assert.equal(finalEarning, originalEarning, "Webhook duplicates and Owner recovery must not duplicate Creator earnings.");
}

async function createNativePaidOrder(nativeOrders, db, product) {
  const attempt = "trgca_c1000001-0000-4000-8000-000000000001";
  const createdAt = new Date(NOW).toISOString();
  const result = await nativeOrders.createOrGetNativePendingOrder(db, {
    checkoutAttemptId: attempt, checkoutRequestHash: "b".repeat(64), createdAt,
    currency: "USD", customerEmail: "c1-buyer@example.test", customerEmailHash: "c1-buyer-hash",
    customerEmailNormalized: "c1-buyer@example.test", publicId: "TRG-C1-NATIVE-RECOVERY",
    subtotalCents: 700, totalCents: 700, userId: "c1-buyer"
  }, [{
    authorSlugsJson: JSON.stringify(["rv-sawyer"]), catalogRevision: product.revision,
    creatorFeeBasisPoints: 2000, creatorFeePolicyEffectiveAt: createdAt,
    creatorFeePolicyReason: "standard", creatorCommissionCategory: "standard",
    creatorCommissionPolicyVersion: "legacy-marketplace-policy", creatorFirstPublishedAt: product.publishedAt,
    creatorFixedFeeCents: 0, creatorReserveDays: 14, creatorFeePolicyId: null,
    createdAt, currency: product.currency, deliveryContentType: product.deliveryContentType,
    deliveryFilename: product.deliveryFilename, deliveryR2Key: product.deliveryR2Key,
    effectiveUnitPriceCents: 700, lastUpdatedSnapshot: product.updatedAt,
    lineTotalCents: 700, listPriceCents: 700, minimumPriceCents: null,
    nativeCreatorId: product.creatorId, nativeProductId: product.id, pricingModel: "fixed",
    primaryAuthorSlug: "rv-sawyer", productSlug: product.slug,
    productStatus: product.status, productTitleSnapshot: product.title,
    publicationState: "published", quantity: 1, suggestedPriceCents: null,
    versionSnapshot: "1.0"
  }]);
  await nativeOrders.attachNativeStripeCheckoutSession(db, Number(result.order.id), {
    id: "cs_test_c1_native", url: "https://checkout.stripe.test/c/pay/cs_test_c1_native"
  }, { updatedAt: createdAt });
  return {
    item: (await nativeOrders.getNativeOrderItemSnapshots(db, Number(result.order.id)))[0],
    order: await getOrder(db, result.order.id)
  };
}

function paidEvent(order, id, options = {}) {
  const metadata = {
    trg_checkout_attempt_id: order.checkout_attempt_id,
    trg_order_id: String(order.id),
    trg_order_public_id: order.public_id
  };
  if (options.includeNativeSource !== false && order.catalog_source === "native_d1") metadata.trg_order_source = "native_d1";
  return {
    api_version: API_VERSION, created: Math.floor(NOW / 1000),
    data: { object: {
      amount_total: Number(order.total_cents), currency: String(order.currency).toLowerCase(),
      id: order.stripe_checkout_session_id, livemode: false, metadata,
      object: "checkout.session", payment_intent: order.catalog_source === "native_d1" ? "pi_c1_native_paid" : "pi_c1_legacy_paid",
      payment_status: "paid", ui_mode: "hosted_page"
    } },
    id, livemode: false, object: "event", type: "checkout.session.completed"
  };
}

async function deliverWebhook(webhook, db, event, bucket, deliveryProducts = {}) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET),
    { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(`${timestamp}.${body}`))).toString("hex");
  return webhook.handleStripeWebhookRequest(new Request("https://example.test/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body
  }), {
    PAYMENT_PIPELINE_STAGE: "staging", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TRG_ORDERS: db, TRG_PRODUCTS: bucket
  }, { deliveryProducts, nowMs: NOW });
}

function createDatabase() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(file => file.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  const db = {
    prepare(sql) {
      let values = [];
      return {
        sql,
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values).changes) } }; }
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
  return { raw, db };
}

function createBucket() {
  const objects = new Map();
  return {
    objects, requestedKeys: [],
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length } : null; },
    async get(key) {
      this.requestedKeys.push(key);
      const bytes = objects.get(key);
      return bytes ? { body: new Response(bytes).body, size: bytes.length } : null;
    }
  };
}

async function getOrder(db, id) {
  return db.prepare("SELECT * FROM orders WHERE id=?").bind(Number(id)).first();
}

async function count(db, table, key, value, type = null) {
  const clause = type == null ? "" : " AND entry_type=?";
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key}=?${clause}`)
    .bind(...(type == null ? [value] : [value, type])).first();
  return Number(row.count);
}

function load(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
