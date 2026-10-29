const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-29T20:00:00.000Z");
const EMAIL_SECRET = "task-2g-order-hash-secret";
const ATTEMPTS = [
  "trgca_21000000-0000-4000-8000-000000000001",
  "trgca_21000000-0000-4000-8000-000000000002",
  "trgca_21000000-0000-4000-8000-000000000003",
  "trgca_21000000-0000-4000-8000-000000000004",
  "trgca_21000000-0000-4000-8000-000000000005"
];

async function main() {
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.ok(routes.include.includes("/api/cart/prepare-order"), "The native preparation endpoint must be routed through Pages Functions.");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const nativeOrders = await load("functions/_lib/native-order-preparation.mjs");
  const orders = await load("functions/_lib/orders-d1.mjs");
  const { raw, db } = database();
  raw.exec("UPDATE runtime_settings SET setting_value='OPEN' WHERE setting_key='store_state'");
  raw.exec(`INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,closure_state,created_at,updated_at)
    VALUES('task2g-ineligible','task2g-ineligible','Ineligible Creator','suspended','suspended','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  const base = {
    creatorId: "creator-rv-sawyer", publicationState: "published", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500, currency: "USD",
    coverR2Key: "catalog-publications/task2g/cover.webp",
    deliveryR2Key: "catalog-publications/task2g/delivery.pdf",
    deliveryFilename: "task2g.pdf", deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], version: "1.0" }
  };
  const fixed = await catalog.createProduct(db, { ...base, id: "task2g-fixed", slug: "task2g-fixed", title: "Task 2G Fixed" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2g-free", slug: "task2g-free", title: "Task 2G Free",
    status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0 }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2g-pwyw", slug: "task2g-pwyw", title: "Task 2G PWYW",
    status: "pay-what-you-want", pricingModel: "pwyw", priceCents: 700,
    minimumPriceCents: 250, suggestedPriceCents: 700 }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2g-draft", slug: "task2g-draft", title: "Task 2G Draft", publicationState: "draft" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2g-paused", slug: "task2g-paused", title: "Task 2G Paused", publicationState: "paused" }, { nowMs: NOW });
  await catalog.createProduct(db, { ...base, id: "task2g-ineligible-product", slug: "task2g-ineligible", title: "Task 2G Ineligible", creatorId: "task2g-ineligible" }, { nowMs: NOW });
  const legacy = [{
    authorDisplay: "Legacy Author", authorSlugs: ["legacy-author"], buyMode: "cart", currency: "USD",
    lastUpdated: "2026-01-01", priceCents: 400, pricingModel: "fixed", saleEnabled: false,
    slug: "legacy-task2g", status: "available-direct", title: "Legacy Task 2G", version: "legacy"
  }];
  const prepare = (attempt, items) => nativeOrders.handleNativeOrderPreparationRequest(request(attempt, items), {
    ORDER_EMAIL_HASH_SECRET: EMAIL_SECRET, TRG_ORDERS: db
  }, {
    accountSession: null, catalogProducts: legacy, includeNative: true, now: NOW,
    publicIdGenerator: () => `TRG-TASK2G-${attempt.slice(-4)}`, skipIdentityChecks: true
  });

  let response = await prepare(ATTEMPTS[0], [{ slug: "task2g-fixed", quantity: 1, amountCents: 1, priceCents: 1 }]);
  let body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.totalCents, 500, "Fixed price must be resolved from D1, not browser input.");
  assert.equal(body.nativeOrderState, "pending");
  assert.equal(body.paymentStatus, "pending");
  assert.equal(body.fulfillmentStatus, "pending");
  assert.equal(body.paymentActivation, false);
  assert.equal(body.items[0].effectiveUnitPriceCents, 500);
  assert.equal(body.items[0].catalogRevision, 1);
  assert.equal(JSON.stringify(body).includes("delivery.pdf"), false, "Private delivery keys must not appear in browser responses.");

  let order = raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(ATTEMPTS[0]);
  let item = raw.prepare("SELECT * FROM order_items WHERE order_id=?").get(order.id);
  assert.equal(order.catalog_source, "native_d1");
  assert.equal(order.native_order_state, "pending");
  assert.equal(order.payment_source, "none");
  assert.equal(order.settlement_method, "no_payment");
  assert.equal(item.native_product_id, "task2g-fixed");
  assert.equal(item.native_creator_id, "creator-rv-sawyer");
  assert.equal(item.catalog_revision, 1);
  assert.equal(item.pricing_model_snapshot, "fixed");
  assert.equal(item.selected_price_cents, 500);
  assert.equal(item.delivery_r2_key_snapshot, base.deliveryR2Key);
  assert.equal(item.delivery_filename_snapshot, base.deliveryFilename);
  assert.equal(item.delivery_content_type_snapshot, base.deliveryContentType);
  assert.throws(() => raw.prepare("UPDATE order_items SET selected_price_cents=1 WHERE id=?").run(item.id), /immutable/i);

  response = await prepare(ATTEMPTS[0], [{ slug: "task2g-fixed", quantity: 1, amountCents: 1 }]);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reusedCheckoutAttempt, true);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=?").get(ATTEMPTS[0]).n, 1);

  const revised = await catalog.updateProduct(db, fixed.id, { title: "Task 2G Fixed Revised", priceCents: 650 }, {
    expectedRevision: fixed.revision, nowMs: NOW + 60_000
  });
  response = await prepare(ATTEMPTS[0], [{ slug: "task2g-fixed", quantity: 1 }]);
  assert.equal(response.status, 409, "A reused attempt must not mutate its immutable snapshot after repricing.");
  order = raw.prepare("SELECT * FROM orders WHERE checkout_attempt_id=?").get(ATTEMPTS[0]);
  item = raw.prepare("SELECT * FROM order_items WHERE order_id=?").get(order.id);
  assert.equal(order.total_cents, 500);
  assert.equal(item.product_title_snapshot, "Task 2G Fixed");
  assert.equal(item.catalog_revision, 1);
  assert.equal(item.effective_unit_price_cents, 500);

  response = await prepare(ATTEMPTS[1], [{ slug: "task2g-fixed", quantity: 1, priceCents: 1 }]);
  body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.totalCents, 650);
  assert.equal(body.items[0].catalogRevision, revised.revision);

  response = await prepare(ATTEMPTS[2], [{ slug: "task2g-pwyw", quantity: 1, amountCents: 525 }]);
  body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.totalCents, 525);
  item = raw.prepare("SELECT oi.* FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.checkout_attempt_id=?").get(ATTEMPTS[2]);
  assert.equal(item.pricing_model_snapshot, "pwyw");
  assert.equal(item.selected_price_cents, 525);
  assert.equal(item.minimum_price_cents_snapshot, 250);
  assert.equal(item.suggested_price_cents_snapshot, 700);
  response = await prepare(ATTEMPTS[2], [{ slug: "task2g-pwyw", quantity: 1, amountCents: 600 }]);
  assert.equal(response.status, 409, "Changed PWYW selection under one attempt must be rejected.");

  response = await prepare(ATTEMPTS[3], [{ slug: "task2g-free", quantity: 1, amountCents: 999 }]);
  body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.totalCents, 0);
  assert.equal(body.paymentStatus, "pending", "Free preparation must not activate free acquisition.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders WHERE payment_status='paid'").get().n, 0);

  for (const [slug, code] of [
    ["task2g-draft", "unpublished_product"],
    ["task2g-paused", "paused_product"],
    ["task2g-ineligible", "ineligible_creator"]
  ]) {
    response = await prepare(ATTEMPTS[4], [{ slug, quantity: 1 }]);
    body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.unavailableItems[0].code, code);
  }

  response = await prepare(ATTEMPTS[4], [
    { slug: "legacy-task2g", quantity: 1 }, { slug: "task2g-fixed", quantity: 1 }
  ]);
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "mixed_order_preparation_not_supported");
  response = await prepare(ATTEMPTS[4], [{ slug: "legacy-task2g", quantity: 1 }]);
  body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "legacy_order_preparation_not_supported");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders WHERE checkout_attempt_id=?").get(ATTEMPTS[4]).n, 0);

  const legacyOrder = await orders.createPendingOrder(db, {
    currency: "USD", customerEmail: "legacy@example.test", customerEmailHash: "legacy-hash",
    customerEmailNormalized: "legacy@example.test", subtotalCents: 400, totalCents: 400
  }, [{
    authorSlugsJson: "[\"legacy-author\"]", currency: "USD", effectiveUnitPriceCents: 400,
    lastUpdatedSnapshot: "2026-01-01", lineTotalCents: 400, listPriceCents: 400,
    primaryAuthorSlug: "legacy-author", productSlug: "legacy-direct", productTitleSnapshot: "Legacy Direct",
    quantity: 1, versionSnapshot: "legacy"
  }], { publicIdGenerator: () => "TRG-LEGACY-TASK2G" });
  assert.equal(legacyOrder.catalog_source, "legacy");
  assert.equal(legacyOrder.native_order_state, null);
  assert.equal(raw.prepare("SELECT catalog_source FROM order_items WHERE order_id=?").get(legacyOrder.id).catalog_source, "legacy");

  for (const state of ["paid", "free_acquired", "canceled", "failed", "pending"]) {
    raw.prepare("UPDATE orders SET native_order_state=? WHERE id=?").run(state, order.id);
    assert.equal(raw.prepare("SELECT native_order_state FROM orders WHERE id=?").get(order.id).native_order_state, state);
  }
  assert.throws(() => raw.prepare("UPDATE orders SET native_order_state='unknown' WHERE id=?").run(order.id), /CHECK/i);
  raw.close();
  console.log("Native D1 order foundation tests passed.");
}

function request(checkoutAttemptId, items) {
  return new Request("https://example.test/api/cart/prepare-order", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      checkoutAttemptId, email: "buyer@example.test", emailConfirmation: "buyer@example.test", items
    })
  });
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

function load(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
