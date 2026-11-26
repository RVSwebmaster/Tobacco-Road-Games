const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, ".wrangler", "prod-schema-copy.sql");
const focusedPath = path.join(root, "ops", "releases", "creator-profile-shelf-081", "creator-profile-shelf-081.sql");
const numberedPath = path.join(root, "migrations", "080_creator_profile_shelf_selections.sql");
const sql = fs.readFileSync(focusedPath, "utf8");
assert.equal(fs.existsSync(schemaPath), true, "Export a schema-only copy of current production before running this test.");
assert.equal(sql, fs.readFileSync(numberedPath, "utf8"), "The focused production migration and numbered migration must stay identical.");
assert.equal(crypto.createHash("sha256").update(sql).digest("hex"), crypto.createHash("sha256").update(fs.readFileSync(numberedPath)).digest("hex"));

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON;");
db.exec(fs.readFileSync(schemaPath, "utf8"));
const hasObject = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name));
assert.equal(hasObject("creator_effective_capacity_categories"), false, "Production baseline must reproduce the missing deferred view.");
assert.equal(hasObject("creator_profile_shelf_selections"), false);

const snapshotCounts = () => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  .map(({ name }) => [name, Number(db.prepare(`SELECT COUNT(*) count FROM \"${name.replaceAll("\"", "\"\"")}\"`).get().count)]));
db.prepare("INSERT OR REPLACE INTO runtime_settings(setting_key,setting_value,updated_at,updated_by) VALUES('store_state','CLOSED','2026-11-25T00:00:00.000Z','migration-fixture')").run();
db.prepare("INSERT INTO users(id,email_normalized,created_at,updated_at) VALUES('shelf-migration-sentinel','migration-sentinel@example.invalid','2026-11-25T00:00:00.000Z','2026-11-25T00:00:00.000Z')").run();
const beforeCounts = snapshotCounts();
db.exec(sql);
const afterCounts = snapshotCounts();
assert.deepEqual(Object.fromEntries(Object.keys(beforeCounts).map(name => [name, afterCounts[name]])), beforeCounts,
  "Applying the migration must preserve every pre-existing row count.");
assert.equal(db.prepare("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").get().setting_value, "CLOSED");
for (const name of ["creator_profile_shelf_owner_insert", "creator_profile_shelf_capacity_insert", "creator_profile_shelf_identity_immutable"])
  assert.equal(hasObject(name), true, `Migration creates ${name}.`);
db.exec(sql);

const stamp = "2026-11-25T00:00:00.000Z";
function creator(id, role = "user", category = "standard") {
  const userId = `user-${id}`;
  db.prepare("INSERT INTO users(id,email_normalized,role,created_at,updated_at) VALUES(?,?,?,?,?)").run(userId, `${id}@example.invalid`, role, stamp, stamp);
  db.prepare("INSERT INTO marketplace_creators(id,slug,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, id, id, stamp, stamp);
  db.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','primary_free',?,?)").run(id, userId, stamp, stamp);
  if (category === "founding25") db.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES(?,?,'founding25',?,?,?,?)").run(`assignment-${id}`, id, "2026-01-01T00:00:00.000Z", "shelf-migration-sentinel", "fixture", stamp);
  if (category === "premier") db.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,created_at,updated_at) VALUES(?,?,'annual_prepaid',20000,'2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',?,?)").run(`term-${id}`, id, stamp, stamp);
}
function product(id, ownerId) {
  db.prepare("INSERT INTO marketplace_products(id,slug,creator_id,title,status,buy_mode,price_cents,created_at,updated_at) VALUES(?,?,?,?,'available-direct','cart',500,?,?)").run(id, id, ownerId, id, stamp, stamp);
}
function addShelves(id, limit) {
  for (let index = 0; index < limit; index++) {
    const item = `product-${id}-${index}`;
    product(item, id);
    db.prepare("INSERT INTO creator_profile_shelf_selections(creator_id,product_id,position,selected_at,updated_at) VALUES(?,?,?,?,?)").run(id, item, index, stamp, stamp);
  }
  const overflow = `product-${id}-overflow`;
  product(overflow, id);
  assert.throws(() => db.prepare("INSERT INTO creator_profile_shelf_selections(creator_id,product_id,position,selected_at,updated_at) VALUES(?,?,?,?,?)").run(id, overflow, limit, stamp, stamp), /creator profile shelf capacity exceeded/);
}

creator("standard");
creator("founder", "user", "founding25");
creator("premium", "user", "premier");
creator("owner", "owner");
creator("admin", "admin");
creator("ownership-check");
addShelves("standard", 6);
addShelves("founder", 12);
addShelves("premium", 12);
addShelves("owner", 14);
for (let index = 0; index < 16; index++) {
  const item = `product-admin-${index}`;
  product(item, "admin");
  db.prepare("INSERT INTO creator_profile_shelf_selections(creator_id,product_id,position,selected_at,updated_at) VALUES(?,?,?,?,?)").run("admin", item, index, stamp, stamp);
}
product("wrong-owner-product", "founder");
assert.throws(() => db.prepare("INSERT INTO creator_profile_shelf_selections(creator_id,product_id,position,selected_at,updated_at) VALUES('ownership-check','wrong-owner-product',0,?,?)").run(stamp, stamp), /profile shelf product belongs to another Creator/);
assert.throws(() => db.prepare("UPDATE creator_profile_shelf_selections SET product_id='wrong-owner-product' WHERE creator_id='standard' AND position=0").run(), /profile shelf identity is immutable/);
assert.equal(db.prepare("SELECT publication_state,storefront_visibility FROM marketplace_products WHERE id='product-standard-0'").get().publication_state, "draft", "Shelf membership does not publish or otherwise mutate the catalog product.");
db.close();
console.log("Production-schema Creator shelf migration and capacity tests passed.");
