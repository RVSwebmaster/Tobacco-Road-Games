const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_PATHS = [
  "001_direct_storefront.sql",
  "003_checkout_attempt_idempotency.sql",
  "004_verified_stripe_webhooks.sql",
  "005_secure_download_entitlements.sql"
].map((name) => path.join(ROOT, "migrations", name));
const SECRET = "secure-download-test-secret-which-is-long-enough";
const NOW = Date.parse("2026-07-14T18:00:00.000Z");
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsecure test PDF\n%%EOF\n");
let fixtureSequence = 0;

async function main() {
  const orders = await importModule("functions/_lib/orders-d1.mjs");
  const fulfillment = await importModule("functions/_lib/order-fulfillment.mjs");
  const authorization = await importModule("functions/_lib/download-authorization.mjs");
  const download = await importModule("functions/_lib/download-route.mjs");
  const fulfillmentRepairRoute = await importModule("functions/_lib/fulfillment-repair-route.mjs");
  const checkoutPages = await importModule("functions/_lib/checkout-pages.mjs");
  const checkoutCookie = await importModule("functions/_lib/checkout-cookie.mjs");
  const publicAssetPolicy = await importModule("functions/_lib/product-asset-policy.mjs");

  await testPaidUnpaidDuplicateAndRepair(orders, fulfillment);
  await testMissingObject(orders, fulfillment);
  await testOperationalRepairRoute(orders, fulfillmentRepairRoute);
  await testCredentialsAndDelivery(orders, fulfillment, authorization, download);
  await testSubstitutionAndRevocation(orders, fulfillment, authorization, download);
  await testCompletionPageStates(orders, fulfillment, checkoutPages, checkoutCookie);
  await testNoPublicPdfAccess(publicAssetPolicy);

  console.log("Secure Agency download tests passed.");
}

async function testOperationalRepairRoute(orders, fulfillmentRepairRoute) {
  const fixture = await createFixture(orders, true);
  const paidAt = (await orders.getOrderById(fixture.d1, fixture.order.id)).paid_at;
  const stripeSession = matchingStripeSession(fixture.order);
  const fetchImpl = async (url, init) => {
    assert.match(url, new RegExp(`/checkout/sessions/${fixture.order.stripe_checkout_session_id}$`));
    assert.equal(init.headers["stripe-version"], "2026-06-24.dahlia");
    return new Response(JSON.stringify(stripeSession), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  };
  const request = () => new Request("https://example.com/api/orders/repair-fulfillment", {
    body: JSON.stringify({ sessionId: fixture.order.stripe_checkout_session_id }),
    headers: { "content-type": "application/json", origin: "https://example.com" },
    method: "POST"
  });
  const env = {
    PAYMENT_PIPELINE_STAGE: "staging",
    STRIPE_SECRET_KEY: "sk_test_secure_repair_fixture",
    TRG_ORDERS: fixture.d1,
    TRG_PRODUCTS: createBucket()
  };

  let response = await fulfillmentRepairRoute.handleFulfillmentRepairRequest(request(), env, {
    fetchImpl,
    nowMs: NOW
  });
  assert.equal(response.status, 200, "A server-verified paid Stripe Session should repair fulfillment.");
  response = await fulfillmentRepairRoute.handleFulfillmentRepairRequest(request(), env, {
    fetchImpl,
    nowMs: NOW + 1000
  });
  assert.equal(response.status, 200, "The operational repair route should be idempotent.");
  assert.equal(await countRows(fixture.d1, "download_entitlements"), 1);
  assert.equal((await orders.getOrderById(fixture.d1, fixture.order.id)).paid_at, paidAt);

  const mismatch = await createFixture(orders, true);
  response = await fulfillmentRepairRoute.handleFulfillmentRepairRequest(
    new Request("https://example.com/api/orders/repair-fulfillment", {
      body: JSON.stringify({ sessionId: mismatch.order.stripe_checkout_session_id }),
      headers: { "content-type": "application/json", origin: "https://example.com" },
      method: "POST"
    }),
    {
      ...env,
      TRG_ORDERS: mismatch.d1
    },
    {
      fetchImpl: async () => new Response(JSON.stringify({
        ...matchingStripeSession(mismatch.order),
        amount_total: Number(mismatch.order.total_cents) + 1
      }), { status: 200 })
    }
  );
  assert.equal(response.status, 409, "A Stripe/order mismatch must not repair fulfillment.");
  assert.equal(await countRows(mismatch.d1, "download_entitlements"), 0);

  const unpaid = await createFixture(orders, false);
  response = await fulfillmentRepairRoute.handleFulfillmentRepairRequest(
    new Request("https://example.com/api/orders/repair-fulfillment", {
      body: JSON.stringify({ sessionId: unpaid.order.stripe_checkout_session_id }),
      headers: { "content-type": "application/json", origin: "https://example.com" },
      method: "POST"
    }),
    { ...env, TRG_ORDERS: unpaid.d1 }
  );
  assert.equal(response.status, 409, "An unpaid order must not be repairable.");
  assert.equal(await countRows(unpaid.d1, "download_entitlements"), 0);
}

async function testPaidUnpaidDuplicateAndRepair(orders, fulfillment) {
  const unpaid = await createFixture(orders, false);
  let result = await fulfillment.repairPaidOrderFulfillment(unpaid.d1, createBucket(), unpaid.order.id, { nowMs: NOW });
  assert.equal(result.result, "order_not_paid", "Unpaid orders must not receive entitlements.");
  assert.equal(await countRows(unpaid.d1, "download_entitlements"), 0);

  const paid = await createFixture(orders, true);
  const paidAt = (await orders.getOrderById(paid.d1, paid.order.id)).paid_at;
  result = await fulfillment.repairPaidOrderFulfillment(paid.d1, createBucket(), paid.order.id, { nowMs: NOW });
  assert.equal(result.ready, true, "A paid Agency order should be repairable into a ready state.");
  assert.equal(result.entitlements.length, 1, "Paid repair should create one entitlement per order item.");
  result = await fulfillment.repairPaidOrderFulfillment(paid.d1, createBucket(), paid.order.id, { nowMs: NOW + 1000 });
  assert.equal(result.ready, true, "Repeating paid repair should be safe.");
  assert.equal(await countRows(paid.d1, "download_entitlements"), 1, "Duplicate repair must not duplicate entitlements.");
  const repaired = await orders.getOrderById(paid.d1, paid.order.id);
  assert.equal(repaired.fulfillment_status, "ready");
  assert.equal(repaired.paid_at, paidAt, "Fulfillment repair must not alter the payment timestamp.");
}

async function testMissingObject(orders, fulfillment) {
  const fixture = await createFixture(orders, true);
  const result = await fulfillment.repairPaidOrderFulfillment(fixture.d1, createBucket({ missing: true }), fixture.order.id, { nowMs: NOW });
  assert.equal(result.result, "object_missing", "A missing private object should create a recoverable fulfillment failure.");
  const order = await orders.getOrderById(fixture.d1, fixture.order.id);
  assert.equal(order.payment_status, "paid", "A storage failure must preserve verified paid status.");
  assert.equal(order.fulfillment_status, "failed");
  assert.equal(order.fulfillment_failure_code, "object_missing");
  assert.equal(await countRows(fixture.d1, "download_entitlements"), 0, "Missing files must not receive entitlements.");
}

async function testCredentialsAndDelivery(orders, fulfillment, authorization, download) {
  const fixture = await createFixture(orders, true);
  const repaired = await fulfillment.repairPaidOrderFulfillment(fixture.d1, createBucket(), fixture.order.id, { nowMs: NOW });
  const entitlement = repaired.entitlements[0];
  const credential = await authorization.createDownloadCredential(entitlement, SECRET, { nowMs: NOW });
  const bucket = createBucket();
  const request = new Request(`https://example.com/store/download?credential=${encodeURIComponent(credential)}`);
  let response = await download.handleAuthorizedDownload(request, {
    DOWNLOAD_SIGNING_SECRET: SECRET,
    TRG_ORDERS: fixture.d1,
    TRG_PRODUCTS: bucket
  }, { nowMs: NOW + 1000 });
  assert.equal(response.status, 200, "A valid credential should retrieve the entitled PDF.");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition") || "", /filename="Agency\.pdf"/);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-length"), String(PDF_BYTES.length));
  assert.match(Buffer.from(await response.arrayBuffer()).toString("utf8"), /^%PDF-/);

  response = await download.handleAuthorizedDownload(request, {
    DOWNLOAD_SIGNING_SECRET: SECRET,
    TRG_ORDERS: fixture.d1,
    TRG_PRODUCTS: bucket
  }, { nowMs: NOW + 2000 });
  assert.equal(response.status, 200, "The same unexpired credential must allow a browser retry.");
  await response.arrayBuffer();
  assert.equal(await countRows(fixture.d1, "download_attempts"), 2, "Both successful retrievals should be recorded.");
  const refreshed = await fulfillment.getEntitlementById(fixture.d1, entitlement.id);
  assert.equal(refreshed.successful_download_count, 2);
  assert.ok(refreshed.first_downloaded_at, "The first successful download time should be retained.");

  const altered = `${credential.startsWith("A") ? "B" : "A"}${credential.slice(1)}`;
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${altered}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: fixture.d1, TRG_PRODUCTS: bucket },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "An altered credential must fail.");

  const shortCredential = await authorization.createDownloadCredential(entitlement, SECRET, {
    nowMs: NOW,
    ttlSeconds: 1
  });
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${shortCredential}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: fixture.d1, TRG_PRODUCTS: bucket },
    { nowMs: NOW + 2000 }
  );
  assert.equal(response.status, 410, "An expired credential must fail.");

  const unknownCredential = await authorization.createDownloadCredential({
    id: 999999,
    order_id: entitlement.order_id,
    order_item_id: entitlement.order_item_id,
    product_slug: "agency"
  }, SECRET, { nowMs: NOW });
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${unknownCredential}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: fixture.d1, TRG_PRODUCTS: bucket },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "An unknown entitlement must fail.");
}

async function testSubstitutionAndRevocation(orders, fulfillment, authorization, download) {
  const crossProductFixture = await createFixture(orders, true);
  let repaired = await fulfillment.repairPaidOrderFulfillment(
    crossProductFixture.d1,
    createBucket(),
    crossProductFixture.order.id,
    { nowMs: NOW }
  );
  let entitlement = repaired.entitlements[0];
  let credential = await authorization.createDownloadCredential({
    ...entitlement,
    product_slug: "another-product"
  }, SECRET, { nowMs: NOW });
  let response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${credential}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: crossProductFixture.d1, TRG_PRODUCTS: createBucket() },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "A validly signed cross-product credential must fail.");

  credential = await authorization.createDownloadCredential(entitlement, SECRET, { nowMs: NOW });
  await crossProductFixture.d1.prepare(`
    UPDATE download_entitlements SET r2_object_key = 'another-product/product.pdf' WHERE id = ?
  `).bind(entitlement.id).run();
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${credential}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: crossProductFixture.d1, TRG_PRODUCTS: createBucket() },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "An entitlement with a substituted R2 key must fail before R2 access.");

  const revokedFixture = await createFixture(orders, true);
  repaired = await fulfillment.repairPaidOrderFulfillment(revokedFixture.d1, createBucket(), revokedFixture.order.id, { nowMs: NOW });
  entitlement = repaired.entitlements[0];
  credential = await authorization.createDownloadCredential(entitlement, SECRET, { nowMs: NOW });
  await revokedFixture.d1.prepare(`
    UPDATE download_entitlements SET status = 'revoked', revoked_at = ? WHERE id = ?
  `).bind(new Date(NOW).toISOString(), entitlement.id).run();
  response = await download.handleAuthorizedDownload(
    new Request(`https://example.com/store/download?credential=${credential}`),
    { DOWNLOAD_SIGNING_SECRET: SECRET, TRG_ORDERS: revokedFixture.d1, TRG_PRODUCTS: createBucket() },
    { nowMs: NOW + 1000 }
  );
  assert.equal(response.status, 403, "A revoked entitlement must fail.");
}

async function testCompletionPageStates(orders, fulfillment, checkoutPages, checkoutCookie) {
  const fixture = await createFixture(orders, false);
  const cookie = await checkoutCookie.createCheckoutAccessCookie({
    createdAt: new Date().toISOString(),
    publicOrderReference: fixture.order.public_id,
    stripeCheckoutSessionId: fixture.order.stripe_checkout_session_id
  }, "checkout-cookie-secret");
  const request = () => new Request(
    `https://example.com/store/checkout/complete?session_id=${fixture.order.stripe_checkout_session_id}`,
    { headers: { cookie } }
  );
  const baseEnv = {
    CHECKOUT_ACCESS_COOKIE_SECRET: "checkout-cookie-secret",
    DOWNLOAD_SIGNING_SECRET: SECRET,
    TRG_ORDERS: fixture.d1
  };

  let response = await checkoutPages.handleCheckoutCompletePage(request(), baseEnv);
  let body = await response.text();
  assert.match(body, /Payment processing/i);
  assert.doesNotMatch(body, /Download Agency PDF/i, "Unpaid orders must not display a download control.");

  await orders.updateOrderPaymentStatus(fixture.d1, fixture.order.id, {
    paidAt: new Date(NOW).toISOString(),
    paymentStatus: "paid",
    stripePaymentIntentId: "pi_test_secure_download"
  });
  response = await checkoutPages.handleCheckoutCompletePage(request(), baseEnv);
  body = await response.text();
  assert.match(body, /download is being prepared/i, "Paid orders awaiting fulfillment should show preparation.");
  assert.doesNotMatch(body, /Download Agency PDF/i);

  await fixture.d1.prepare(`
    UPDATE orders SET fulfillment_status = 'failed', fulfillment_failure_code = 'object_missing' WHERE id = ?
  `).bind(fixture.order.id).run();
  response = await checkoutPages.handleCheckoutCompletePage(request(), baseEnv);
  body = await response.text();
  assert.match(body, /download needs attention/i, "Fulfillment failures should show a support-oriented message.");
  assert.doesNotMatch(body, /object_missing/i, "Internal failure codes must not be exposed.");

  await fulfillment.repairPaidOrderFulfillment(fixture.d1, createBucket(), fixture.order.id, { nowMs: NOW });
  response = await checkoutPages.handleCheckoutCompletePage(request(), baseEnv);
  body = await response.text();
  assert.match(body, /Download Agency PDF/i, "A ready active entitlement should display the download button.");
  assert.match(body, /\/store\/download\?credential=/i, "The completion page should use the private server download route.");
}

async function testNoPublicPdfAccess(publicAssetPolicy) {
  assert.equal(publicAssetPolicy.isPublicProductAsset("cover.webp"), true);
  assert.equal(publicAssetPolicy.isPublicProductAsset("preview.webp"), true);
  assert.equal(
    publicAssetPolicy.isPublicProductAsset("product.pdf"),
    false,
    "product.pdf must remain unavailable through the public asset route policy."
  );
}

async function createFixture(orders, paid) {
  fixtureSequence += 1;
  const { d1, raw } = createD1Database();
  const suffix = String(fixtureSequence).padStart(4, "0");
  let order = await orders.createPendingOrder(d1, {
    checkoutAttemptId: `trgca_10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    checkoutRequestHash: String(fixtureSequence).padStart(64, "a"),
    currency: "USD",
    customerEmail: "buyer@example.com",
    customerEmailHash: `hash-${suffix}`,
    customerEmailNormalized: "buyer@example.com",
    publicId: `TRG-DOWNLOAD-${suffix}`,
    subtotalCents: 400,
    totalCents: 400
  }, [{
    authorSlugsJson: JSON.stringify(["rv-sawyer"]),
    currency: "USD",
    effectiveUnitPriceCents: 400,
    lastUpdatedSnapshot: "2026-07-01",
    lineTotalCents: 400,
    listPriceCents: 500,
    primaryAuthorSlug: "rv-sawyer",
    productSlug: "agency",
    productTitleSnapshot: "Agency",
    quantity: 1,
    versionSnapshot: "2026.1"
  }]);
  order = await orders.attachStripeCheckoutSession(d1, order.id, {
    id: `cs_test_download_${suffix}`,
    url: `https://checkout.stripe.com/c/pay/cs_test_download_${suffix}`
  }, { updatedAt: new Date(NOW - 60000).toISOString() });
  if (paid) {
    order = await orders.updateOrderPaymentStatus(d1, order.id, {
      paidAt: new Date(NOW - 30000).toISOString(),
      paymentStatus: "paid",
      stripePaymentIntentId: `pi_test_download_${suffix}`
    });
  }
  return { d1, order, raw };
}

function createBucket(options = {}) {
  return {
    async get(key) {
      if (options.missing || key !== "agency/product.pdf") {
        return null;
      }
      return { body: PDF_BYTES, size: PDF_BYTES.length };
    },
    async head(key) {
      if (options.missing || key !== "agency/product.pdf") {
        return null;
      }
      return { size: 9630946 };
    }
  };
}

function matchingStripeSession(order) {
  return {
    amount_total: Number(order.total_cents),
    currency: String(order.currency).toLowerCase(),
    id: order.stripe_checkout_session_id,
    livemode: false,
    metadata: {
      trg_checkout_attempt_id: order.checkout_attempt_id,
      trg_order_id: String(order.id),
      trg_order_public_id: order.public_id
    },
    object: "checkout.session",
    payment_intent: order.stripe_payment_intent_id,
    payment_status: "paid",
    status: "complete"
  };
}

function createD1Database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const migrationPath of MIGRATION_PATHS) {
    raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  return { d1: createD1Adapter(raw), raw };
}

function createD1Adapter(raw) {
  return {
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE TRANSACTION");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql) {
      return createPreparedStatement(raw.prepare(sql));
    }
  };
}

function createPreparedStatement(statement, boundValues = []) {
  return {
    all() {
      return Promise.resolve({ results: statement.all(...boundValues) });
    },
    bind(...values) {
      return createPreparedStatement(statement, values);
    },
    first() {
      return Promise.resolve(statement.get(...boundValues) || null);
    },
    run() {
      const result = statement.run(...boundValues);
      return Promise.resolve({
        meta: {
          changes: Number(result.changes ?? 0),
          last_row_id: Number(result.lastInsertRowid ?? 0)
        }
      });
    }
  };
}

async function countRows(d1, tableName) {
  const row = await d1.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first();
  return Number(row?.count || 0);
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
