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
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const db = d1(raw),
    service = await load("functions/_lib/creator-service-purchases.mjs"),
    ads = await load("functions/_lib/creator-advertising.mjs");
  seed(raw);
  let state = await ads.getAdvertising(db, "creator", { nowMs: NOW });
  assert.equal(state.includedEntitlement, 1);
  assert.equal(state.unusedCredits, 0);
  const monthly = await service.purchaseServiceWithCreatorBalance(db, {
    creatorId: "creator",
    userId: "user",
    sku: "preferred_monthly",
    idempotencyKey: "svc_00000000-0000-4000-8000-000000000001",
    nowMs: NOW,
  });
  assert.equal(monthly.amountCents, 2000);
  assert.equal(monthly.processorFeeCents, 0);
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM creator_balance_transactions WHERE transaction_type='service_debit'",
      )
      .get().amount_cents,
    -2000,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM marketplace_service_revenue_ledger WHERE service_type='preferred_creator_fee'",
      )
      .get().amount_cents,
    2000,
  );
  state = await ads.getAdvertising(db, "creator", { nowMs: NOW });
  assert.equal(state.includedEntitlement, 5);
  await assert.rejects(
    () =>
      service.purchaseServiceWithCreatorBalance(db, {
        creatorId: "creator",
        userId: "user",
        sku: "preferred_monthly",
        idempotencyKey: "svc_00000000-0000-4000-8000-000000000004",
        nowMs: NOW,
      }),
    /does not cover/,
  );
  const credits = await service.purchaseServiceWithCreatorBalance(db, {
    creatorId: "creator",
    userId: "user",
    sku: "ad_credit_package",
    idempotencyKey: "svc_00000000-0000-4000-8000-000000000002",
    nowMs: NOW,
  });
  assert.equal(credits.creditsIssued, 5);
  assert.equal(
    raw.prepare("SELECT SUM(quantity) n FROM creator_ad_credit_ledger").get().n,
    5,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT amount_cents FROM marketplace_service_revenue_ledger WHERE service_type='ad_credit_package'",
      )
      .get().amount_cents,
    500,
  );
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM order_items").get().n, 0);
  await assert.rejects(
    () =>
      service.purchaseServiceWithCreatorBalance(db, {
        creatorId: "creator",
        userId: "user",
        sku: "ad_credit_package",
        idempotencyKey: "svc_00000000-0000-4000-8000-000000000003",
        nowMs: NOW,
      }),
    /does not cover/,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_balance_reservations WHERE state='reserved'",
      )
      .get().n,
    0,
  );
  const slot = await ads.redeemCredit(db, {
    creatorId: "creator",
    creativeId: "creative-1",
    actorId: "user",
    nowMs: NOW,
  });
  assert.equal(Date.parse(slot.expiresAt) - NOW, 30 * 86400000);
  state = await ads.getAdvertising(db, "creator", { nowMs: NOW });
  assert.equal(state.unusedCredits, 4);
  assert.equal(
    state.slots.filter((x) => x.slot_type === "purchased").length,
    1,
  );
  await ads.reassignSlot(db, {
    creatorId: "creator",
    slotId: slot.id,
    creativeId: "creative-2",
    actorId: "user",
    nowMs: NOW + 86400000,
  });
  const swapped = raw
    .prepare("SELECT * FROM creator_ad_slots WHERE id=?")
    .get(slot.id);
  assert.equal(swapped.creative_id, "creative-2");
  assert.equal(swapped.expires_at, slot.expiresAt);
  assert.equal(
    raw.prepare("SELECT SUM(quantity) n FROM creator_ad_credit_ledger").get().n,
    4,
  );
  await ads.expireSlots(db, "creator", NOW + 31 * 86400000);
  assert.ok(
    raw
      .prepare("SELECT deactivated_at FROM creator_ad_slots WHERE id=?")
      .get(slot.id).deactivated_at,
  );
  assert.equal(
    raw.prepare("SELECT SUM(quantity) n FROM creator_ad_credit_ledger").get().n,
    4,
  );
  state = await ads.getAdvertising(db, "creator", {
    nowMs: NOW + 31 * 86400000,
  });
  assert.equal(state.includedEntitlement, 1);
  const source = read("functions/_lib/creator-service-purchases.mjs"),
    ui = read("assets/js/creator-dashboard.js") + read("creator/index.html");
  assert.doesNotMatch(source, /createStripe|stripe-checkout/i);
  assert.match(ui, /split tender/i);
  assert.match(ui, /purchase_credits_with_creator_balance/);
  assert.match(ui, /action:\s*["']reassign/);
  console.log("Creator Balance service purchase tests passed.");
}
function seed(raw) {
  raw
    .prepare(
      "INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at)VALUES('user','u@test.invalid',1,'active','user',?,?)",
    )
    .run(ISO, ISO);
  raw
    .prepare(
      "INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,created_at,updated_at)VALUES('creator','creator','Creator','approved',?,?)",
    )
    .run(ISO, ISO);
  raw
    .prepare(
      "INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,entitlement_source,created_at,updated_at)VALUES('creator','user','primary','active','primary_free',?,?)",
    )
    .run(ISO, ISO);
  raw
    .prepare(
      "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,idempotency_key,created_at)VALUES('creator','manual_adjustment',2500,'USD',?,'available','fixture','balance',?)",
    )
    .run(ISO, ISO);
  for (const [id, slug] of [
    ["listing-1", "one"],
    ["listing-2", "two"],
  ])
    raw
      .prepare(
        "INSERT INTO creator_listings(id,creator_id,slug,source_product_slug,title,lifecycle_state,publication_state,inactivity_state,created_at,updated_at)VALUES(?,'creator',?,?,?,'active','published','active',?,?)",
      )
      .run(id, slug, slug, slug, ISO, ISO);
  for (const [id, listing] of [
    ["creative-1", "listing-1"],
    ["creative-2", "listing-2"],
  ])
    raw
      .prepare(
        "INSERT INTO creator_ad_creatives(id,creator_id,listing_id,alt_text,original_filename,normalized_filename,content_type,size_bytes,staging_key,public_object_key,validation_state,created_at)VALUES(?,'creator',?,'Alt','a.png','a.png','image/png',10,'stage','public','accepted',?)",
      )
      .run(id, listing, ISO);
}
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}
function load(file) {
  return import(pathToFileURL(path.join(ROOT, file)).href + `?${Date.now()}`);
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
        for (const item of items) out.push(await item.run());
        raw.exec("COMMIT");
        return out;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
