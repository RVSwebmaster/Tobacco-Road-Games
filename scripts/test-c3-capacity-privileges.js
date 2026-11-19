const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.now(), NOW = new Date(NOW_MS).toISOString();

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).filter((name) => name.endsWith(".sql")).sort())
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  const db = d1(raw), policy = await load("functions/_lib/marketplace-policy.mjs"), auth = await load("functions/_lib/account-auth.mjs"), creatorOps = await load("functions/_lib/creator-operations.mjs");
  const accounts = [
    ["standard", "standard-user", "user"],
    ["founder", "founder-user", "user"],
    ["premier", "premier-user", "user"],
    ["admin", "admin-user", "admin"],
    ["owner", "owner-user", "owner"],
    ["shelf", "shelf-user", "user"],
    ["outsider", "outsider-user", "user"],
  ];
  for (const [, userId, role] of accounts) addUser(raw, userId, role);
  for (const [creatorId, userId] of accounts) addCreator(raw, creatorId, userId);
  addListing(raw, "founder-product", "founder", "founder-product", "published");
  raw.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES('f25-active','founder','founding25',?,'owner-user','C3 capacity test',?)").run(NOW, NOW);
  raw.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES('premier-active','premier','annual_prepaid',20000,?,?,'renews','active',?,?)").run(new Date(NOW_MS - 1000).toISOString(), new Date(NOW_MS + 365 * 86400000).toISOString(), NOW, NOW);
  assertLimits(await policy.getCreatorCapacity(db, "standard", NOW_MS), 12, 6, "standard");
  assertLimits(await policy.getCreatorCapacity(db, "founder", NOW_MS), 24, 12, "founding25");
  assertLimits(await policy.getCreatorCapacity(db, "premier", NOW_MS), 24, 12, "premier");
  assertLimits(await policy.getCreatorCapacity(db, "admin", NOW_MS), null, null, "admin");
  assertLimits(await policy.getCreatorCapacity(db, "owner", NOW_MS), null, 14, "owner");

  // A Founding-25 change applies immediately. Revocation keeps existing rows
  // intact and blocks new publications above the new Standard limit.
  for (let i = 0; i < 23; i++) addListing(raw, `founder-over-${i}`, "founder", `founder-over-${i}`, "published");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE creator_id='founder' AND publication_state='published'").get().n, 24);
  raw.prepare("UPDATE creator_commission_category_assignments SET revoked_at=? WHERE id='f25-active'").run(NOW);
  assertLimits(await policy.getCreatorCapacity(db, "founder", NOW_MS + 1), 12, 6, "standard");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE creator_id='founder' AND publication_state='published'").get().n, 24, "downgrade must preserve existing products");
  const overflow = addListing(raw, "founder-after-revoke", "founder", "founder-after-revoke", "draft");
  await assert.rejects(() => policy.assertPublicationCapacity(db, overflow, NOW_MS + 1), /capacity is 12/i);
  assert.throws(() => publishListing(raw, overflow.id), /active catalog capacity exceeded/i);

  // A paid Premier account receives the same 24-slot ceiling. Admin and Owner
  // identities retain unlimited catalog capacity through the same final guard.
  for (let i = 0; i < 24; i++) addListing(raw, `premier-live-${i}`, "premier", `premier-live-${i}`, "published");
  const premierOverflow = addListing(raw, "premier-overflow", "premier", "premier-overflow", "draft");
  await assert.rejects(() => policy.assertPublicationCapacity(db, premierOverflow, NOW_MS), /capacity is 24/i);
  assert.throws(() => publishListing(raw, premierOverflow.id), /active catalog capacity exceeded/i);
  for (const creatorId of ["owner", "admin"]) {
    for (let i = 0; i < 15; i++) addListing(raw, `${creatorId}-catalog-${i}`, creatorId, `${creatorId}-catalog-${i}`, "published");
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE creator_id=? AND publication_state='published'").get(creatorId).n, 15);
  }

  // Both requests observe the last free slot before either commits. The
  // database final guard allows exactly one transition.
  for (let i = 0; i < 11; i++) addListing(raw, `race-live-${i}`, "standard", `race-live-${i}`, "published");
  const raceA = addListing(raw, "race-a", "standard", "race-a", "draft"), raceB = addListing(raw, "race-b", "standard", "race-b", "draft");
  const preflight = await Promise.all([policy.assertPublicationCapacity(db, raceA, NOW_MS), policy.assertPublicationCapacity(db, raceB, NOW_MS)]);
  assert.deepEqual(preflight.map((row) => row.nextActive), [12, 12]);
  const publishResults = await Promise.allSettled([raceA, raceB].map((listing) => Promise.resolve().then(() => publishListing(raw, listing.id))));
  assert.equal(publishResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(publishResults.filter((result) => result.status === "rejected").length, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_listings WHERE creator_id='standard' AND publication_state='published'").get().n, 12);
  const rejectedRaceListing = publishResults[0].status === "rejected" ? raceA : raceB;

  // Shelf checks also race at the final write; null-linked catalog products
  // count as occupied slots and cannot bypass Creator allocation.
  for (let i = 0; i < 5; i++) addProduct(raw, `shelf-live-${i}`, "shelf", "listed");
  const shelfListingA = addListing(raw, "shelf-a-listing", "shelf", "shelf-a", "published"), shelfListingB = addListing(raw, "shelf-b-listing", "shelf", "shelf-b", "published");
  addProduct(raw, "shelf-a", "shelf", "unlisted", shelfListingA.id);
  addProduct(raw, "shelf-b", "shelf", "unlisted", shelfListingB.id);
  const shelfPreflight = await Promise.all([policy.assertShelfCapacity(db, shelfListingA, NOW_MS), policy.assertShelfCapacity(db, shelfListingB, NOW_MS)]);
  assert.deepEqual(shelfPreflight.map((row) => row.nextShelved), [6, 6]);
  const shelfResults = await Promise.allSettled(["shelf-a", "shelf-b"].map((id) => Promise.resolve().then(() => raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id=?").run(id))));
  assert.equal(shelfResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(shelfResults.filter((result) => result.status === "rejected").length, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE creator_id='shelf' AND publication_state='published' AND storefront_visibility='listed'").get().n, 6);

  raw.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES('f25-restored','founder','founding25',?,'owner-user','Explicit C3 capacity test reassignment',?)").run(NOW, NOW);
  assertLimits(await policy.getCreatorCapacity(db, "founder", NOW_MS), 24, 12, "founding25");
  for (const creatorId of ["founder", "premier"]) {
    for (let i = 0; i < 13; i++) addProduct(raw, `${creatorId}-shelf-${i}`, creatorId, "unlisted");
    for (let i = 0; i < 12; i++) raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id=?").run(`${creatorId}-shelf-${i}`);
    assert.throws(() => raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id=?").run(`${creatorId}-shelf-12`), /creator shelf capacity exceeded/i);
  }

  // Admin and Owner retain their approved capacity without a bypass path for
  // another Creator. Owner is capped at 14 shelf slots; Admin is not.
  for (let i = 0; i < 15; i++) addProduct(raw, `owner-shelf-${i}`, "owner", "unlisted");
  for (let i = 0; i < 15; i++) addProduct(raw, `admin-shelf-${i}`, "admin", "unlisted");
  for (let i = 0; i < 14; i++) raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id=?").run(`owner-shelf-${i}`);
  assert.throws(() => raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id='owner-shelf-14'").run(), /creator shelf capacity exceeded/i);
  for (let i = 0; i < 15; i++) raw.prepare("UPDATE marketplace_products SET storefront_visibility='listed' WHERE id=?").run(`admin-shelf-${i}`);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE creator_id='admin' AND storefront_visibility='listed'").get().n, 15);

  // A signed-in user without membership cannot target another Creator's
  // over-capacity listing, even with a valid CSRF token.
  await insertSession(raw, auth, "outsider-user");
  const unauthorized = new Request(`https://trg.test/api/creator/listings/${rejectedRaceListing.id}/publish?creator=standard`, {
    method: "POST", headers: { origin: "https://trg.test", cookie: "__Host-trg_session=outsider-user; trg_account_csrf=outsider-user-csrf", "x-csrf-token": "outsider-user-csrf", "content-type": "application/json" }, body: "{}",
  });
  const unauthorizedResponse = await creatorOps.handleCreatorRequest(unauthorized, { TRG_ORDERS: db }, { database: db, nowMs: NOW_MS });
  assert.equal(unauthorizedResponse.status, 403);
  assert.equal(raw.prepare("SELECT publication_state FROM creator_listings WHERE id=?").get(rejectedRaceListing.id).publication_state, "approved");
  raw.close();
  console.log("C3 account capacity privilege and concurrency tests passed.");
}

function addUser(raw, id, role) {
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)").run(id, `${id}@capacity.test`, role, NOW, NOW);
}
function addCreator(raw, id, userId) {
  raw.prepare("INSERT INTO marketplace_creators(id,slug,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, `${id}-slug`, id, NOW, NOW);
  raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','not_required','primary_free',?,?)").run(id, userId, NOW, NOW);
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)").run(userId, id, NOW);
}
function addListing(raw, id, creatorId, slug, publicationState) {
  const state = publicationState === "draft" ? "approved" : publicationState;
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,lifecycle_state,publication_state,pricing_model,created_at,updated_at) VALUES(?,?,?,?,'active',?,'fixed',?,?)").run(id, creatorId, slug, slug, state, NOW, NOW);
  return { id, creator_id: creatorId, pricing_model: "fixed" };
}
function publishListing(raw, id) {
  return raw.prepare("UPDATE creator_listings SET publication_state='published' WHERE id=? AND publication_state<>'published'").run(id);
}
function addProduct(raw, id, creatorId, visibility, listingId = null) {
  raw.prepare("INSERT INTO marketplace_products(id,slug,creator_id,creator_listing_id,publication_state,title,status,buy_mode,currency,pricing_model,price_cents,storefront_visibility,created_at,updated_at) VALUES(?,?,?,?,'published',?,'available-direct','fixed-price','USD','fixed',100,?,?,?)").run(id, `${id}-slug`, creatorId, listingId, id, visibility, NOW, NOW);
}
function assertLimits(value, catalog, shelf, category) {
  assert.equal(value.activeListingCap, catalog, `${category} catalog allowance`);
  assert.equal(value.shelfCap, shelf, `${category} shelf allowance`);
  assert.equal(value.category, category);
}
async function insertSession(raw, auth, id) {
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${id}-session`, id, await auth.hashToken(id), await auth.hashToken(`${id}-csrf`), NOW, new Date(NOW_MS + 86400000).toISOString(), NOW);
}
function d1(raw) {
  return { prepare(sql) { let values = []; return { bind(...next) { values = next; return this; }, first: async () => raw.prepare(sql).get(...values) || null, all: async () => ({ results: raw.prepare(sql).all(...values) }), run: async () => { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) }, changes: Number(result.changes) }; } }; }, async batch(statements) { raw.exec("BEGIN"); try { for (const statement of statements) await statement.run(); raw.exec("COMMIT"); } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
}
function load(file) { return import(pathToFileURL(path.join(ROOT, file)).href + `?c3=${Math.random()}`); }
main().catch((error) => { console.error(error); process.exitCode = 1; });
