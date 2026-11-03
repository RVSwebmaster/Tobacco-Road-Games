const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "migrations");
const CONTINUITY_MIGRATION = "068_agency_legacy_continuity.sql";
const NOW = Date.parse("2026-11-03T16:00:00.000Z");
const SECRET = "agency-continuity-test-secret-long-enough";
const EXPECTED_SIZE = 9630946;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nAgency continuity fixture\n%%EOF\n");
const HISTORICAL_SLUGS = ["circle-of-cinder", "janni", "ringbound", "tablecraft-primer"];

async function main() {
  const orders = await importModule("functions/_lib/orders-d1.mjs");
  const catalog = await importModule("functions/_lib/product-catalog-d1.mjs");
  const authorization = await importModule("functions/_lib/download-authorization.mjs");
  const download = await importModule("functions/_lib/download-route.mjs");
  const fulfillment = await importModule("functions/_lib/order-fulfillment.mjs");

  const fixture = await createHistoricalFixture(orders);
  const before = snapshot(fixture.raw);
  assert.deepEqual(before.statusCounts, { expired: 1, failed: 2, paid: 2, pending: 1 });
  assert.equal(before.orders.length, 6);
  assert.equal(before.entitlements.length, 2);

  applyMigration(fixture.raw, CONTINUITY_MIGRATION);
  verifyContinuityIdentity(fixture.raw);
  assert.deepEqual(snapshot(fixture.raw), before, "The migration must not alter historical orders or entitlements.");

  applyMigration(fixture.raw, CONTINUITY_MIGRATION);
  assert.equal(count(fixture.raw, "marketplace_products", "slug='agency'"), 1, "Migration retry must not duplicate Agency.");
  assert.equal(count(fixture.raw, "download_entitlements"), 2, "Migration retry must not duplicate entitlements.");

  await verifySecureContinuity(fixture, authorization, download, fulfillment);
  await verifyCollisionFailsClosed(catalog);

  console.log("Agency native D1/R2 continuity tests passed.");
  console.log("Historical orders preserved: 6; active paid entitlements preserved: 2.");
  console.log("Other historical catalog products published: 0.");
}

async function createHistoricalFixture(orders) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of migrationFiles().filter((name) => name !== CONTINUITY_MIGRATION)) {
    applyMigration(raw, file);
  }
  const d1 = d1Adapter(raw);
  const statuses = ["paid", "paid", "failed", "failed", "pending", "expired"];
  const created = [];
  for (let index = 0; index < statuses.length; index += 1) {
    const sequence = index + 1;
    let order = await orders.createPendingOrder(d1, {
      checkoutAttemptId: `trgca_2ab00000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      checkoutRequestHash: String(sequence).repeat(64),
      currency: "USD",
      customerEmail: `agency-buyer-${sequence}@example.invalid`,
      customerEmailHash: `agency-hash-${sequence}`,
      customerEmailNormalized: `agency-buyer-${sequence}@example.invalid`,
      publicId: `TRG-AGENCY-CONTINUITY-${sequence}`,
      subtotalCents: 300,
      totalCents: 300
    }, [{
      authorSlugsJson: JSON.stringify(["rv-sawyer"]),
      currency: "USD",
      effectiveUnitPriceCents: 300,
      lastUpdatedSnapshot: "2026-06-24",
      lineTotalCents: 300,
      listPriceCents: 400,
      primaryAuthorSlug: "rv-sawyer",
      productSlug: "agency",
      productTitleSnapshot: "Agency",
      quantity: 1,
      versionSnapshot: "1.0"
    }]);
    if (statuses[index] === "paid") {
      order = await orders.updateOrderPaymentStatus(d1, order.id, {
        paidAt: new Date(NOW - sequence * 1000).toISOString(),
        paymentStatus: "paid",
        stripePaymentIntentId: `pi_agency_continuity_${sequence}`
      });
      raw.prepare("UPDATE orders SET fulfillment_status='ready' WHERE id=?").run(order.id);
      const item = raw.prepare("SELECT id FROM order_items WHERE order_id=?").get(order.id);
      raw.prepare(`INSERT INTO download_entitlements(
        order_id,order_item_id,product_slug,r2_object_key,customer_filename,
        content_type,object_size_bytes,status,created_at
      ) VALUES(?,?,'agency','agency/product.pdf','Agency.pdf','application/pdf',?,'active',?)`).run(
        order.id,
        item.id,
        EXPECTED_SIZE,
        new Date(NOW - sequence * 1000).toISOString()
      );
    } else if (statuses[index] !== "pending") {
      raw.prepare("UPDATE orders SET payment_status=? WHERE id=?").run(statuses[index], order.id);
    }
    created.push(order.id);
  }
  return { d1, orderIds: created, raw };
}

function verifyContinuityIdentity(raw) {
  const product = raw.prepare("SELECT * FROM marketplace_products WHERE slug='agency'").get();
  assert.ok(product, "Agency must have one native continuity identity.");
  assert.equal(product.id, "legacy:agency");
  assert.equal(product.creator_id, "creator-rv-sawyer");
  assert.equal(product.creator_listing_id, null);
  assert.equal(product.publication_state, "retired");
  assert.equal(product.status, "legacy-not-for-sale");
  assert.equal(product.buy_mode, "retired");
  assert.equal(product.delivery_r2_key, null, "An unavailable R2 object must not be represented as verified delivery.");
  assert.equal(JSON.parse(product.metadata_json).operationSeverance.deliveryAssetStatus, "authoritative-staging-object-unavailable");
  assert.equal(count(raw, "marketplace_products", `slug IN (${HISTORICAL_SLUGS.map(() => "?").join(",")})`, HISTORICAL_SLUGS), 0);
}

async function verifySecureContinuity(fixture, authorization, download, fulfillment) {
  const entitlement = await fulfillment.getOrderEntitlements(fixture.d1, fixture.orderIds[0], { activeOnly: true });
  assert.equal(entitlement.length, 1);
  const credential = await authorization.createDownloadCredential(entitlement[0], SECRET, { nowMs: NOW });
  const request = () => new Request(`https://example.com/store/download?credential=${encodeURIComponent(credential)}`);
  const bucket = agencyBucket();

  let response = await download.handleAuthorizedDownload(request(), env(fixture.d1, bucket), { nowMs: NOW + 1000 });
  assert.equal(response.status, 200, "The retired D1 identity and exact entitlement snapshot must authorize delivery.");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition") || "", /Agency\.pdf/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF_BYTES);

  response = await download.handleAuthorizedDownload(request(), env(fixture.d1, bucket), { nowMs: NOW + 2000 });
  assert.equal(response.status, 200, "A retry must remain authorized without creating ownership records.");
  await response.arrayBuffer();
  assert.equal(count(fixture.raw, "download_entitlements"), 2);
  assert.equal(count(fixture.raw, "marketplace_products", "slug='agency'"), 1);
  assert.equal(count(fixture.raw, "download_attempts", "entitlement_id=?", [entitlement[0].id]), 2);

  const repaired = await fulfillment.repairPaidOrderFulfillment(
    fixture.d1,
    bucket,
    fixture.orderIds[0],
    { nowMs: NOW + 3000 }
  );
  assert.equal(repaired.ready, true, "Fulfillment repair must resolve Agency through D1 continuity data.");
  assert.equal(repaired.result, "already_fulfillment_ready");
  assert.equal(count(fixture.raw, "download_entitlements"), 2);

  response = await download.handleAuthorizedDownload(request(), env(fixture.d1, agencyBucket({ missing: true })), { nowMs: NOW + 4000 });
  assert.equal(response.status, 503, "A missing authoritative object must fail without revoking ownership.");
  assert.equal(fixture.raw.prepare("SELECT status FROM download_entitlements WHERE id=?").get(entitlement[0].id).status, "active");

  fixture.raw.prepare("UPDATE download_entitlements SET r2_object_key='unrelated/private.pdf' WHERE id=?").run(entitlement[0].id);
  response = await download.handleAuthorizedDownload(request(), env(fixture.d1, bucket), { nowMs: NOW + 5000 });
  assert.equal(response.status, 403, "A substituted entitlement key must fail before R2 access.");
  fixture.raw.prepare("UPDATE download_entitlements SET r2_object_key='agency/product.pdf' WHERE id=?").run(entitlement[0].id);

  const unknown = await authorization.createDownloadCredential({ ...entitlement[0], product_slug: "ringbound" }, SECRET, { nowMs: NOW });
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${encodeURIComponent(unknown)}`),
    env(fixture.d1, bucket),
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "Another historical slug must not inherit Agency continuity.");
}

async function verifyCollisionFailsClosed(catalog) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of migrationFiles().filter((name) => name !== CONTINUITY_MIGRATION)) applyMigration(raw, file);
  const d1 = d1Adapter(raw);
  await catalog.createProduct(d1, {
    buyMode: "retired",
    creatorId: "creator-rv-sawyer",
    id: "conflicting-agency",
    priceCents: 0,
    pricingModel: "free",
    publicationState: "retired",
    slug: "agency",
    status: "retired",
    title: "Conflicting Agency"
  }, { nowMs: NOW });
  assert.throws(
    () => applyMigration(raw, CONTINUITY_MIGRATION),
    /CHECK constraint failed|constraint failed/i,
    "A conflicting Agency identity must abort the migration."
  );
  assert.equal(count(raw, "marketplace_products"), 1);
  assert.equal(raw.prepare("SELECT id FROM marketplace_products WHERE slug='agency'").get().id, "conflicting-agency");
  raw.close();
}

function snapshot(raw) {
  const orders = raw.prepare(`SELECT id,public_id,payment_status,fulfillment_status,total_cents
    FROM orders WHERE id IN (SELECT order_id FROM order_items WHERE product_slug='agency') ORDER BY id`).all();
  const entitlements = raw.prepare(`SELECT id,order_id,order_item_id,product_slug,r2_object_key,
    customer_filename,content_type,object_size_bytes,status,successful_download_count
    FROM download_entitlements WHERE product_slug='agency' ORDER BY id`).all();
  const statusCounts = Object.fromEntries(raw.prepare(`SELECT payment_status,COUNT(*) count FROM orders
    WHERE id IN (SELECT order_id FROM order_items WHERE product_slug='agency')
    GROUP BY payment_status ORDER BY payment_status`).all().map((row) => [row.payment_status, row.count]));
  return { entitlements, orders, statusCounts };
}

function agencyBucket({ missing = false } = {}) {
  return {
    async get(key) {
      if (missing || key !== "agency/product.pdf") return null;
      return { body: PDF_BYTES, size: EXPECTED_SIZE };
    },
    async head(key) {
      if (missing || key !== "agency/product.pdf") return null;
      return { size: EXPECTED_SIZE };
    }
  };
}

function env(database, bucket) {
  return { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: database, TRG_PRODUCTS: bucket };
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
}

function applyMigration(raw, file) {
  raw.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
}

function count(raw, table, where = "1=1", values = []) {
  return raw.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get(...values).count;
}

function d1Adapter(raw) {
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE TRANSACTION");
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
    prepare(sql) { return prepared(raw.prepare(sql)); }
  };
}

function prepared(statement, values = []) {
  return {
    all() { return Promise.resolve({ results: statement.all(...values) }); },
    bind(...next) { return prepared(statement, next); },
    first() { return Promise.resolve(statement.get(...values) || null); },
    run() {
      const result = statement.run(...values);
      return Promise.resolve({ meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } });
    }
  };
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
