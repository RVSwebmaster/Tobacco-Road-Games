const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const { createOwnerAuthFixture } = require("./test-support/owner-auth-fixture.js");

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-10-22T18:00:00.000Z");
const ISO = new Date(NOW).toISOString();

main().catch((error) => { console.error(error); process.exitCode = 1; });

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  applyMigrations(raw);
  seed(raw);
  const database = createD1(raw);
  const module = await import(`${pathToFileURL(path.join(ROOT, "functions/_lib/owner-profile.mjs")).href}?test=${Math.random()}`);
  const ownerAuth = await import(`${pathToFileURL(path.join(ROOT, "functions/_lib/owner-auth.mjs")).href}?test=${Math.random()}`);
  const auth = await createOwnerAuthFixture({ ownerAuth, ownerId: "rv-owner@example.test", nowMs: NOW });
  const env = { ...auth.environment, TRG_ORDERS: database };
  const options = { database, nowMs: NOW, ...auth.options };

  const denied = await module.handleOwnerProfileRequest(new Request("https://example.com/owner/api/profile"), env, options);
  assert.equal(denied.status, 403, "Private Owner Profile must reject requests without Access identity.");

  let response = await module.handleOwnerProfileRequest(auth.readRequest("/owner/api/profile"), env, options);
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.configured, true);
  assert.equal(payload.purchases.length, 2);
  assert.equal(payload.catalog.length, 14, "Owner catalog includes every managed listing without a capacity cap.");
  assert.equal(payload.limits.library, 36);
  assert.equal(payload.limits.shelf, 12);

  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_library", productSlugs: ["purchased-one", "purchased-two"] }), env, options);
  assert.equal(response.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) total FROM account_library_shelf_selections").get().total, 2);
  assert.deepEqual(raw.prepare("SELECT product_slug FROM account_library_shelf_selections ORDER BY position").all().map((row) => row.product_slug), ["purchased-one", "purchased-two"]);

  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_library", productSlugs: ["forged-product"] }), env, options);
  assert.equal(response.status, 409, "A non-entitled product cannot be placed in the personal library shelf.");
  assert.equal(raw.prepare("SELECT COUNT(*) total FROM account_library_shelf_selections").get().total, 2, "Rejected changes are atomic.");

  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_library", productSlugs: Array.from({ length: 37 }, (_, index) => `overflow-${index}`) }), env, options);
  assert.equal(response.status, 409, "The 36-title personal shelf boundary is enforced.");

  const shelfIds = Array.from({ length: 12 }, (_, index) => `rv-listing-${index + 1}`);
  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_shelf", listingIds: shelfIds }), env, options);
  assert.equal(response.status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) total FROM creator_profile_shelf_selections").get().total, 12);
  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_shelf", listingIds: [...shelfIds, "other-listing"] }), env, options);
  assert.equal(response.status, 409, "The 12-product public profile shelf boundary is enforced.");
  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_shelf", listingIds: ["other-listing"] }), env, options);
  assert.equal(response.status, 409, "Another Creator's product cannot enter RV Sawyer's shelf.");

  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_appearance", appearanceMode: "day", wallpaperKind: "prepared", wallpaperKey: "trg-classic", wallpaperSaturation: 85 }), env, options);
  assert.equal(response.status, 200);
  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_posters", posters: [{ assetKey: "dragon-battle", altText: "Dragon battle poster" }, { assetKey: "cape-fear", altText: "Cape Fear poster" }] }), env, options);
  assert.equal(response.status, 200, "Owner-managed posters require no separate approval.");
  assert.equal(raw.prepare("SELECT COUNT(*) total FROM creator_profile_posters").get().total, 2);
  response = await module.handleOwnerProfileRequest(auth.jsonRequest("/owner/api/profile", { action: "save_posters", posters: [{ assetKey: "https://evil.invalid/poster.png" }] }), env, options);
  assert.equal(response.status, 409, "Poster URLs are restricted to the approved Owner asset manifest.");

  response = await module.handlePublicCreatorProfileRequest(new Request("https://example.com/api/public-profile/rv-sawyer"), env, { database, slug: "rv-sawyer" });
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.creator.slug, "rv-sawyer");
  assert.equal(payload.shelved.length, 12);
  assert.equal(payload.posters.length, 2);
  assert.equal(payload.appearance.appearanceMode, "day");
  assert.equal("purchases" in payload, false, "Public Creator profile cannot expose purchase history.");
  assert.equal("community" in payload, false, "Public Creator profile cannot expose private community/account state.");
  assert.equal("limits" in payload, false, "Public Creator profile cannot expose private Owner allowances.");

  const storefront = fs.readFileSync(path.join(ROOT, "assets/js/storefront.js"), "utf8");
  assert.match(storefront, /if \(!selected\.length\) return;/, "Decorative Your Library books remain when no authenticated selection exists.");
  assert.match(storefront, /catch\(\(\) => \{ \/\* Decorative books remain the required fallback\. \*\//);
  const build = fs.readFileSync(path.join(ROOT, "scripts/build-store.js"), "utf8");
  assert.match(build, /author\.slug !== "rv-sawyer"/, "RV Sawyer is excluded from the generic Featured Creator selection.");
  assert.match(build, /featuredConfig\.creatorSlug === "rv-sawyer" \? null/, "Explicit RV Featured Creator configuration is rejected.");
  assert.equal(raw.prepare("SELECT COUNT(*) total FROM profile_customization_audit").get().total, 4, "Each successful profile mutation is audited.");
  console.log("Owner Profile Phase 1 tests passed.");
}

function applyMigrations(database) {
  for (const migration of fs.readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(fs.readFileSync(path.join(ROOT, "migrations", migration), "utf8"));
  }
}

function seed(raw) {
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES('rv-user','rv-owner@example.test',1,'active','owner',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES('rv-user','creator-rv-sawyer','manager',?)").run(ISO);
  raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES('creator-rv-sawyer','rv-user','primary','active','not_required','primary_free',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,marketplace_status,registration_status,created_at,updated_at) VALUES('creator-other','other','Other Creator','approved','active',?,?)").run(ISO, ISO);
  for (let index = 1; index <= 12; index += 1) raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,public_product_slug,media_type,inactivity_state,created_at,updated_at) VALUES(?,?,?,?,'active','published',?,'digital','active',?,?)").run(`rv-listing-${index}`, "creator-rv-sawyer", `rv-product-${index}`, `RV Product ${index}`, `rv-product-${index}`, ISO, ISO);
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,public_product_slug,media_type,inactivity_state,created_at,updated_at) VALUES('rv-draft','creator-rv-sawyer','rv-draft','RV Draft','draft','not_approved',NULL,'digital','active',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,public_product_slug,media_type,inactivity_state,created_at,updated_at) VALUES('rv-paused','creator-rv-sawyer','rv-paused','RV Paused','paused','paused','rv-paused','digital','active',?,?)").run(ISO, ISO);
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,public_product_slug,media_type,inactivity_state,created_at,updated_at) VALUES('other-listing','creator-other','other-product','Other Product','active','published','other-product','digital','active',?,?)").run(ISO, ISO);
  for (let index = 1; index <= 2; index += 1) {
    const result = raw.prepare("INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at,user_id,payment_source) VALUES(?,?,?,?, 'USD',100,100,'paid','fulfilled','sent',?,'rv-user','stripe')").run(`ORDER-${index}`, "rv-owner@example.test", "rv-owner@example.test", `hash-${index}`, ISO);
    const orderId = Number(result.lastInsertRowid);
    const item = raw.prepare("INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,currency,version_snapshot,last_updated_snapshot,created_at) VALUES(?,?,?,?,?,1,100,100,100,'USD','1.0',?,?)").run(orderId, `purchased-${index === 1 ? "one" : "two"}`, `Purchased ${index}`, "rv-sawyer", '["rv-sawyer"]', ISO, ISO);
    raw.prepare("INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,customer_filename,content_type,object_size_bytes,status,created_at) VALUES(?,?,?,?,?,'application/pdf',100,'active',?)").run(orderId, Number(item.lastInsertRowid), `purchased-${index === 1 ? "one" : "two"}`, `products/purchased-${index}.pdf`, `purchased-${index}.pdf`, ISO);
  }
}

function createD1(database) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return database.prepare(sql).get(...values) || null; },
        async all() { return { results: database.prepare(sql).all(...values) }; },
        async run() { const result = database.prepare(sql).run(...values); return { changes: Number(result.changes), meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
}
