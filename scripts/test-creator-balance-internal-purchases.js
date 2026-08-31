const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { DatabaseSync } = require("node:sqlite"),
  { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."),
  NOW = Date.parse("2026-08-31T12:00:00Z"),
  ISO = new Date(NOW).toISOString();
async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const f of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", f), "utf8"));
  const db = d1(raw),
    mod = await import(
      pathToFileURL(path.join(ROOT, "functions/_lib/creator-balance.mjs"))
        .href + `?${Date.now()}`
    );
  for (const [id, email] of [
    ["buyer", "buyer@test.invalid"],
    ["seller", "seller@test.invalid"],
  ])
    raw
      .prepare(
        "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at)VALUES(?,?,1,'active','user',?,?)",
      )
      .run(id, email, ISO, ISO);
  for (const [id, slug, user] of [
    ["buyer-c", "buyer-creator", "buyer"],
    ["seller-c", "seller-creator", "seller"],
  ]) {
    raw
      .prepare(
        "INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,created_at,updated_at)VALUES(?,?,?,'approved',?,?)",
      )
      .run(id, slug, slug, ISO, ISO);
    raw
      .prepare(
        "INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,entitlement_source,created_at,updated_at)VALUES(?,?,'primary','active','primary_free',?,?)",
      )
      .run(id, user, ISO, ISO);
  }
  raw
    .prepare(
      "INSERT INTO creator_listings(id,creator_id,slug,source_product_slug,title,publication_state,first_published_at,created_at,updated_at)VALUES('listing','seller-c','product','product','Product','published',?,?,?)",
    )
    .run("2025-01-01T00:00:00.000Z", ISO, ISO);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at)VALUES('buyer-c','manual_adjustment',2000,'USD',?,'available','test','opening',?)",
    )
    .run(ISO, ISO);
  const item = {
      productSlug: "product",
      productTitleSnapshot: "Product",
      primaryAuthorSlug: "seller-creator",
      authorSlugsJson: '["seller-creator"]',
      quantity: 1,
      listPriceCents: 1000,
      effectiveUnitPriceCents: 1000,
      lineTotalCents: 1000,
      currency: "USD",
      versionSnapshot: "1",
      lastUpdatedSnapshot: ISO,
    },
    map = {
      productSlug: "product",
      r2ObjectKey: "product/product.pdf",
      customerFilename: "Product.pdf",
      contentType: "application/pdf",
      objectSize: 100,
    };
  let b = await mod.getCreatorBalance(db, {
    creatorId: "buyer-c",
    userId: "buyer",
    nowMs: NOW,
  });
  assert.equal(b.availableCents, 2000);
  const sale = await mod.settleCreatorBalancePurchase(db, {
    buyerCreatorId: "buyer-c",
    buyerUserId: "buyer",
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000001",
    orderPublicId: "TRG-CB-ONE",
    email: "buyer@test.invalid",
    emailHash: "hash",
    items: [item],
    deliveryMappings: [map],
    nowMs: NOW,
    env: { CREATOR_PAYOUT_RESERVE_DAYS: "30" },
  });
  assert.equal(sale.paymentProvider, "none");
  assert.equal(
    raw.prepare("SELECT payment_source FROM orders").get().payment_source,
    "creator_balance",
  );
  assert.equal(
    raw.prepare("SELECT amount_cents FROM creator_balance_transactions").get()
      .amount_cents,
    -1000,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM marketplace_internal_commission_ledger",
      )
      .get().amount_cents,
    200,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM creator_earnings_ledger WHERE creator_id='seller-c'",
      )
      .get().amount_cents,
    800,
  );
  assert.equal(
    raw.prepare("SELECT status FROM download_entitlements").get().status,
    "active",
  );
  b = await mod.getCreatorBalance(db, {
    creatorId: "buyer-c",
    userId: "buyer",
    nowMs: NOW,
  });
  assert.equal(b.availableCents, 1000);
  const again = await mod.settleCreatorBalancePurchase(db, {
    buyerCreatorId: "buyer-c",
    buyerUserId: "buyer",
      checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000001",
    orderPublicId: "OTHER",
    email: "buyer@test.invalid",
    emailHash: "hash",
    items: [item],
    deliveryMappings: [map],
    nowMs: NOW,
  });
  assert.equal(again.idempotent, true);
  await assert.rejects(
    () =>
      mod.settleCreatorBalancePurchase(db, {
        buyerCreatorId: "buyer-c",
        buyerUserId: "buyer",
          checkoutAttemptId: "trgca_00000000-0000-4000-8000-000000000002",
        orderPublicId: "TRG-CB-TWO",
        email: "buyer@test.invalid",
        emailHash: "hash",
        items: [{ ...item, lineTotalCents: 1001 }],
        deliveryMappings: [map],
        nowMs: NOW,
      }),
    /does not cover/,
  );
  const refund = await mod.refundCreatorBalancePurchase(db, {
    orderPublicId: "TRG-CB-ONE",
    actorId: "operator",
    nowMs: NOW + 1000,
  });
  assert.equal(refund.stripeRefund, false);
  assert.equal(
    raw.prepare("SELECT payment_status FROM orders").get().payment_status,
    "refunded",
  );
  assert.equal(
    raw.prepare("SELECT status FROM download_entitlements").get().status,
    "revoked",
  );
  b = await mod.getCreatorBalance(db, {
    creatorId: "buyer-c",
    userId: "buyer",
    nowMs: NOW + 1000,
  });
  assert.equal(b.availableCents, 2000);
  const source = read("functions/_lib/creator-balance.mjs"),
    route = read("functions/_lib/creator-balance-route.mjs"),
    ui = read("assets/js/creator-balance-checkout.js"),
    rating = read("functions/_lib/creator-reputation.mjs"),
    discovery = read("functions/_lib/marketplace-discovery-labels.mjs");
  assert.doesNotMatch(source, /createStripe|stripe-checkout/i);
  assert.match(route, /paymentSource\s*!==\s*["']creator_balance/);
  assert.match(route, /state\s*!==\s*["']OPEN/);
  assert.match(ui, /Split tender is not available/);
  assert.match(rating, /sellerControlledByCustomer/);
  assert.match(discovery, /own\.owner_user_id<>o\.user_id/);
  console.log("Creator Balance internal purchase tests passed.");
}
function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}
function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return raw.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: raw.prepare(sql).all(...values) };
        },
        async run() {
          return raw.prepare(sql).run(...values);
        },
      };
    },
    async batch(items) {
      raw.exec("BEGIN");
      try {
        const out = [];
        for (const x of items) out.push(await x.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
