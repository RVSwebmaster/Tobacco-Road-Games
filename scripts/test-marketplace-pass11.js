const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, ".."),
  NOW = Date.parse("2027-10-01T12:00:00Z");
assert.deepEqual = (actual, expected) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
async function main() {
  const inactivity = await load("functions/_lib/product-inactivity.mjs"),
    policy = await load("functions/_lib/marketplace-policy.mjs"),
    raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "001_direct_storefront.sql",
    "003_checkout_attempt_idempotency.sql",
    "004_verified_stripe_webhooks.sql",
    "005_secure_download_entitlements.sql",
    "006_customer_delivery_owner_controls.sql",
    "007_shared_accounts.sql",
    "016_order_account_ownership.sql",
    "017_historical_order_claims.sql",
    "018_creator_operations.sql",
    "019_creator_publication_pipeline.sql",
    "020_creator_financial_accounting.sql",
    "021_provider_finance_and_payout_readiness.sql",
    "022_connect_sandbox_and_payout_batches.sql",
    "023_marketplace_policy_alignment.sql",
    "024_product_inactivity_lifecycle.sql",
  ])
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  const db = d1(raw),
    old = new Date(NOW - 365 * 86400000).toISOString(),
    now = new Date(NOW).toISOString();
  creator(raw, "seller", now);
  for (const [id, model] of [
    ["paid", "fixed"],
    ["free", "free"],
    ["pwyw", "pwyw"],
  ])
    listing(raw, id, "seller", old, model);
  let result = await inactivity.runInactivityCheck(db, { nowMs: NOW });
  assert.equal(result.warnings, 3);
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_listings WHERE inactivity_state='warning'",
      )
      .get().n,
    3,
  );
  const grace = raw
    .prepare(
      "SELECT inactivity_grace_ends_at FROM creator_listings WHERE id='paid'",
    )
    .get().inactivity_grace_ends_at;
  assert.equal(Date.parse(grace), NOW + 30 * 86400000);
  result = await inactivity.runInactivityCheck(db, { nowMs: NOW });
  assert.equal(result.warnings, 0);
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_lifecycle_notices WHERE notice_type='inactivity_warning'",
      )
      .get().n,
    3,
  );
  const order = orderRow(raw, now, 0),
    line = item(raw, order, "free", 0, now);
  await inactivity.recordQualifyingActivity(db, { orderId: order, nowMs: NOW });
  assert.equal(
    raw
      .prepare("SELECT inactivity_state FROM creator_listings WHERE id='free'")
      .get().inactivity_state,
    "active",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT activity_type FROM creator_product_activity_events WHERE order_item_id=?",
      )
      .get(line).activity_type,
    "free_acquisition",
  );
  await inactivity.runInactivityCheck(db, { nowMs: NOW + 30 * 86400000 });
  assert.equal(
    raw
      .prepare("SELECT inactivity_state FROM creator_listings WHERE id='paid'")
      .get().inactivity_state,
    "inactive",
  );
  assert.equal(
    raw
      .prepare("SELECT publication_state FROM creator_listings WHERE id='paid'")
      .get().publication_state,
    "paused",
  );
  assert.equal(
    (await policy.getCreatorCapacity(db, "seller", NOW)).activeListingCap,
    20,
  );
  const prior = raw
    .prepare("SELECT first_published_at FROM creator_listings WHERE id='paid'")
    .get().first_published_at;
  raw
    .prepare(
      "INSERT INTO creator_listing_files(id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,validation_state,validation_message,delivery_object_key,uploaded_at) VALUES('file','paid','seller','product','p.pdf','p.pdf','application/pdf',1,'q','accepted','','paid/product.pdf',?)",
    )
    .run(now);
  await assert.rejects(
    () =>
      inactivity.reactivateListing(db, {
        listingId: "paid",
        creatorId: "seller",
        actorId: "seller-user",
        nowMs: NOW + 31 * 86400000,
      }),
    /remain off sale/,
  );
  await inactivity.reactivateListing(db, {
    listingId: "paid",
    creatorId: "seller",
    actorId: "seller-user",
    nowMs: NOW + 61 * 86400000,
  });
  const reactivated = raw
    .prepare(
      "SELECT first_published_at,inactivity_state,publication_state FROM creator_listings WHERE id='paid'",
    )
    .get();
  assert.deepEqual(reactivated, {
    first_published_at: prior,
    inactivity_state: "active",
    publication_state: "approved",
  });
  assert.equal(
    (
      await policy.resolveSalePolicy(db, {
        creatorId: "seller",
        firstPublishedAt: prior,
        nowMs: NOW + 61 * 86400000,
      })
    ).reason,
    "standard",
  );
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) n FROM creator_publication_audit WHERE action='reactivated'",
      )
      .get().n,
    1,
  );
  console.log("Marketplace Pass 11 tests passed.");
}
function creator(r, id, n) {
  r.prepare(
    "INSERT INTO marketplace_creators(id,slug,display_name,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).run(id, id, id, n, n);
}
function listing(r, id, c, n, m) {
  r.prepare(
    "INSERT INTO creator_listings(id,creator_id,slug,source_product_slug,public_product_slug,title,lifecycle_state,publication_state,listed_price_cents,media_type,pricing_model,first_published_at,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'active','published',100,'digital',?,?,?,?,?)",
  ).run(id, c, id, id, id, id, m, n, n, n, n);
}
function orderRow(r, n, total) {
  return Number(
    r
      .prepare(
        "INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,paid_at) VALUES(?,?,?,?,'USD',?,?,'paid','ready','sent',?,?)",
      )
      .run(crypto.randomUUID(), "a@b.com", "a@b.com", "h", total, total, n, n)
      .lastInsertRowid,
  );
}
function item(r, o, s, a, n) {
  return Number(
    r
      .prepare(
        "INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES(?,?,?,'a','[]',1,?,?,?,'USD','1','2027',?)",
      )
      .run(o, s, s, a, a, a, n).lastInsertRowid,
  );
}
function load(n) {
  return import(
    pathToFileURL(path.join(ROOT, n)).href + `?p11=${Math.random()}`
  );
}
function d1(r) {
  return {
    prepare(s) {
      let v = [];
      return {
        bind(...n) {
          v = n;
          return this;
        },
        first: async () => r.prepare(s).get(...v) || null,
        all: async () => ({ results: r.prepare(s).all(...v) }),
        run: async () => {
          const x = r.prepare(s).run(...v);
          return { meta: { changes: Number(x.changes) } };
        },
      };
    },
    async batch(ss) {
      r.exec("BEGIN");
      try {
        for (const s of ss) await s.run();
        r.exec("COMMIT");
      } catch (e) {
        r.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
