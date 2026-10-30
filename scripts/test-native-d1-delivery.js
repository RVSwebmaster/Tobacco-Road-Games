const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-30T18:00:00.000Z");
const ISO = new Date(NOW).toISOString();
const SECRET = "task-2j-download-signing-secret-long-enough";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nTask 2J native secure delivery\n%%EOF\n");
const BUYER = { id: "task2j-buyer", email: "task2j-buyer@example.test" };
const OTHER = { id: "task2j-other", email: "task2j-other@example.test" };
let sequence = 0;

async function main() {
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const nativeOrders = await load("functions/_lib/native-orders-d1.mjs");
  const ownership = await load("functions/_lib/native-entitlements-d1.mjs");
  const authorization = await load("functions/_lib/download-authorization.mjs");
  const download = await load("functions/_lib/download-route.mjs");
  const { raw, db } = database();
  for (const user of [BUYER, OTHER]) {
    raw.prepare(`INSERT INTO users(id,email_normalized,email_verified,email_verified_at,status,role,created_at,updated_at)
      VALUES(?,?,1,?,'active','user',?,?)`).run(user.id, user.email, ISO, ISO, ISO);
  }
  const product = await catalog.createProduct(db, productInput({
    id: "task2j-native", slug: "task2j-native", title: "Task 2J Native",
    deliveryR2Key: "catalog-publications/task2j-original/delivery.pdf",
    deliveryFilename: "Task 2J Purchased.pdf"
  }), { nowMs: NOW });
  const fixture = await paidFixture(nativeOrders, ownership, db, raw, product, BUYER.id);
  const entitlement = fixture.entitlements[0];
  assert.match(entitlement.download_reference, /^[a-f0-9]{32}$/);
  const credential = await authorization.createNativeDownloadCredential(entitlement, SECRET, { nowMs: NOW });
  const payload = JSON.parse(Buffer.from(credential.split(".")[0], "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(payload).sort(), ["entitlementKind", "entitlementReference", "expiresAt", "issuedAt", "version"]);
  assert.equal(payload.entitlementKind, "native_d1");
  assert.equal("orderId" in payload || "orderItemId" in payload, false);
  assert.equal(JSON.stringify(payload).includes(product.deliveryR2Key), false);

  const bucket = createBucket(product.deliveryR2Key);
  const request = () => new Request(`https://example.test/store/download?credential=${encodeURIComponent(credential)}`);
  let response = await download.handleAuthorizedDownload(request(), env(db, bucket), {
    accountSession: session(BUYER), nowMs: NOW + 1000
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition") || "", /Task 2J Purchased\.pdf/);
  assert.equal(response.headers.get("content-length"), String(PDF_BYTES.length));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF_BYTES);
  assert.deepEqual(bucket.requestedKeys, [product.deliveryR2Key]);
  assert.equal(raw.prepare("SELECT successful_download_count FROM native_product_entitlements WHERE id=?").get(entitlement.id).successful_download_count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_download_attempts WHERE entitlement_id=?").get(entitlement.id).n, 1);
  assert.equal(raw.prepare("SELECT fulfillment_status FROM orders WHERE id=?").get(fixture.order.id).fulfillment_status, "fulfilled");

  response = await download.handleAuthorizedDownload(request(), env(db, bucket), {
    accountSession: session(BUYER), nowMs: NOW + 2000
  });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(raw.prepare("SELECT successful_download_count FROM native_product_entitlements WHERE id=?").get(entitlement.id).successful_download_count, 2);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM native_download_attempts WHERE entitlement_id=?").get(entitlement.id).n, 2);

  const unauthorizedBucket = createBucket(product.deliveryR2Key);
  response = await download.handleAuthorizedDownload(request(), env(db, unauthorizedBucket), {
    accountSession: session(OTHER), nowMs: NOW + 3000
  });
  assert.equal(response.status, 403);
  assert.deepEqual(unauthorizedBucket.requestedKeys, []);
  assert.doesNotMatch(await response.text(), /catalog-publications|order_id|customer_email/i);

  const missingCredential = await authorization.createNativeDownloadCredential({ download_reference: "f".repeat(32) }, SECRET, { nowMs: NOW });
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.test/store/download?credential=${encodeURIComponent(missingCredential)}`),
    env(db, createBucket(product.deliveryR2Key)),
    { accountSession: session(BUYER), nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403);
  const altered = `${credential.startsWith("A") ? "B" : "A"}${credential.slice(1)}`;
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.test/store/download?credential=${encodeURIComponent(altered)}`),
    env(db, createBucket(product.deliveryR2Key)),
    { accountSession: session(BUYER), nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403);

  raw.prepare("UPDATE orders SET payment_status='failed',native_order_state='failed' WHERE id=?").run(fixture.order.id);
  const unpaidBucket = createBucket(product.deliveryR2Key);
  response = await download.handleAuthorizedDownload(request(), env(db, unpaidBucket), {
    accountSession: session(BUYER), nowMs: NOW + 4000
  });
  assert.equal(response.status, 403);
  assert.deepEqual(unpaidBucket.requestedKeys, []);
  raw.prepare("UPDATE orders SET payment_status='paid',native_order_state='paid' WHERE id=?").run(fixture.order.id);

  const current = await catalog.getProductById(db, product.id);
  await catalog.updateProduct(db, product.id, {
    deliveryR2Key: "catalog-publications/task2j-live-changed/delivery.pdf",
    priceCents: 1400,
    publicationState: "paused"
  }, { expectedRevision: current.revision, nowMs: NOW + 5000 });
  const snapshotBucket = createBucket(product.deliveryR2Key);
  response = await download.handleAuthorizedDownload(request(), env(db, snapshotBucket), {
    accountSession: session(BUYER), nowMs: NOW + 5000
  });
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF_BYTES);
  assert.deepEqual(snapshotBucket.requestedKeys, [product.deliveryR2Key]);

  const missingBucket = createBucket(product.deliveryR2Key, { missing: true });
  response = await download.handleAuthorizedDownload(request(), env(db, missingBucket), {
    accountSession: session(BUYER), nowMs: NOW + 6000
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /catalog-publications|task2j-original|order/i);
  const failedOrder = raw.prepare("SELECT payment_status,fulfillment_status,fulfillment_failure_code FROM orders WHERE id=?").get(fixture.order.id);
  assert.equal(failedOrder.payment_status, "paid");
  assert.equal(failedOrder.fulfillment_status, "failed");
  assert.equal(failedOrder.fulfillment_failure_code, "object_missing");

  const unreadableBucket = createBucket(product.deliveryR2Key, { throwOnGet: true });
  response = await download.handleAuthorizedDownload(request(), env(db, unreadableBucket), {
    accountSession: session(BUYER), nowMs: NOW + 7000
  });
  assert.equal(response.status, 503);
  assert.equal(raw.prepare("SELECT fulfillment_failure_code FROM orders WHERE id=?").get(fixture.order.id).fulfillment_failure_code, "object_read_failed");

  const invalidProduct = await catalog.createProduct(db, productInput({
    id: "task2j-invalid", slug: "task2j-invalid", title: "Task 2J Invalid",
    deliveryR2Key: "unapproved-private/arbitrary.pdf", deliveryFilename: "Invalid.pdf"
  }), { nowMs: NOW });
  const invalidFixture = await paidFixture(nativeOrders, ownership, db, raw, invalidProduct, BUYER.id);
  const invalidCredential = await authorization.createNativeDownloadCredential(invalidFixture.entitlements[0], SECRET, { nowMs: NOW });
  const arbitraryBucket = createBucket("unapproved-private/arbitrary.pdf");
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.test/store/download?credential=${encodeURIComponent(invalidCredential)}`),
    env(db, arbitraryBucket),
    { accountSession: session(BUYER), nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403);
  assert.deepEqual(arbitraryBucket.requestedKeys, []);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements").get().n, 0);
  raw.close();
  console.log("Secure native D1 R2 delivery tests passed.");
}

async function paidFixture(nativeOrders, ownership, db, raw, product, userId) {
  sequence += 1;
  const createdAt = new Date(NOW + sequence).toISOString();
  const attempt = `trgca_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  const result = await nativeOrders.createOrGetNativePendingOrder(db, {
    checkoutAttemptId: attempt,
    checkoutRequestHash: sequence.toString(16).padStart(64, "0"),
    createdAt, currency: "USD", customerEmail: BUYER.email,
    customerEmailHash: `hash-task2j-${sequence}`, customerEmailNormalized: BUYER.email,
    publicId: `TRG-TASK2J-${String(sequence).padStart(4, "0")}`,
    subtotalCents: Number(product.priceCents), totalCents: Number(product.priceCents), userId
  }, [{
    authorSlugsJson: JSON.stringify(product.metadata.authorSlugs), catalogRevision: product.revision,
    createdAt, currency: product.currency, deliveryContentType: product.deliveryContentType,
    deliveryFilename: product.deliveryFilename, deliveryR2Key: product.deliveryR2Key,
    effectiveUnitPriceCents: Number(product.priceCents), lastUpdatedSnapshot: product.updatedAt,
    lineTotalCents: Number(product.priceCents), listPriceCents: Number(product.priceCents),
    minimumPriceCents: null, nativeCreatorId: product.creatorId, nativeProductId: product.id,
    pricingModel: product.pricingModel, primaryAuthorSlug: product.metadata.authorSlugs[0],
    productSlug: product.slug, productStatus: product.status, productTitleSnapshot: product.title,
    publicationState: product.publicationState, quantity: 1, suggestedPriceCents: null,
    versionSnapshot: product.metadata.version
  }]);
  let order = await nativeOrders.attachNativeStripeCheckoutSession(db, Number(result.order.id), {
    id: `cs_test_task2j_${sequence}`, url: `https://checkout.stripe.test/c/pay/task2j-${sequence}`
  }, { updatedAt: createdAt });
  raw.prepare(`UPDATE orders SET payment_status='paid',native_order_state='paid',stripe_payment_intent_id=?,
    paid_at=?,payment_source='stripe',settlement_method='external_provider' WHERE id=?`)
    .run(`pi_test_task2j_${sequence}`, createdAt, order.id);
  const granted = await ownership.grantNativePaidOrderEntitlements(db, Number(order.id), { nowMs: NOW + sequence });
  assert.equal(granted.ready, true);
  return { entitlements: granted.entitlements, order: raw.prepare("SELECT * FROM orders WHERE id=?").get(order.id) };
}

function productInput(overrides) {
  return {
    creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 700, currency: "USD",
    coverR2Key: `catalog-publications/${overrides.id}/cover.webp`, deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.2" }, ...overrides
  };
}
function session(user) {
  return { valid: true, user: { email_normalized: user.email, email_verified: 1, id: user.id, status: "active" } };
}
function env(db, bucket) { return { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: db, TRG_PRODUCTS: bucket }; }
function createBucket(expectedKey, options = {}) {
  const requestedKeys = [];
  return {
    requestedKeys,
    async get(key) {
      requestedKeys.push(key);
      if (options.throwOnGet) throw new Error("simulated R2 read failure");
      if (options.missing || key !== expectedKey) return null;
      const body = new ReadableStream({ start(controller) { controller.enqueue(PDF_BYTES); controller.close(); } });
      return { body, size: PDF_BYTES.length };
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
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    }
  };
}
function load(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href); }

main().catch(error => { console.error(error); process.exitCode = 1; });
