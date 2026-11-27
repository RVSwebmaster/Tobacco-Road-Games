const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { NOW_MS, createCreator, createD1, load } = require("./test-creator-product-withdrawal.js");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, ".wrangler", "prod-schema-copy.sql");
const migrationPath = path.join(root, "ops", "releases", "creator-test-product-transfer-082", "creator-test-product-transfer-082.sql");
assert.equal(fs.existsSync(schemaPath), true, "Export the current production schema before rehearsing this focused transfer.");

const SOURCE = Object.freeze({
  id: "creator-rv-sawyer",
  userId: "5157e45f-7848-4891-afd6-05e4b6fb6abf",
  slug: "rv-sawyer",
  session: "creator-test-transfer-source-session",
  csrf: "creator-test-transfer-source-csrf"
});
const TARGET = Object.freeze({
  id: "1ca19a95-a84c-468b-aff8-24f194653c6c",
  userId: "ba64b095-7142-423e-9454-649745815c15",
  slug: "trg-test-creator",
  session: "creator-test-transfer-target-session",
  csrf: "creator-test-transfer-target-csrf"
});

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  raw.exec(fs.readFileSync(schemaPath, "utf8"));
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_profile_shelf_selections'").get()) {
    const shelfMigrationPath = path.join(root, "ops", "releases", "creator-profile-shelf-081", "creator-profile-shelf-081.sql");
    raw.exec(fs.readFileSync(shelfMigrationPath, "utf8"));
  }
  raw.prepare("INSERT OR REPLACE INTO runtime_settings(setting_key,setting_value,updated_at,updated_by) VALUES('store_state','CLOSED','2026-11-27T00:00:00.000Z','transfer-fixture')").run();

  const auth = await load("functions/_lib/account-auth.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  await createCreator(raw, auth, SOURCE);
  await createCreator(raw, auth, TARGET);
  raw.prepare("UPDATE users SET role='owner' WHERE id=?").run(SOURCE.userId);
  raw.prepare("UPDATE marketplace_creators SET marketplace_status='pending' WHERE id=?").run(TARGET.id);
  const database = createD1(raw);
  const products = [
    {
      id: "test-rv-ashen-grimoire-2026-11-27",
      slug: "test-ashen-grimoire-rv-2026-11-27",
      title: "The Ashen Grimoire",
      subtitle: "Mock Fantasy RPG Supplement • TEST ONLY • NOT FOR SALE",
      coverR2Key: "test-products/creator-shelf-owner-test-2026-11-27/ashen-grimoire-cover.webp"
    },
    {
      id: "test-rv-black-stars-2026-11-27",
      slug: "test-beyond-black-stars-rv-2026-11-27",
      title: "Beyond the Black Stars",
      subtitle: "Mock Science-Fiction RPG Supplement • TEST ONLY • NOT FOR SALE",
      coverR2Key: "test-products/creator-shelf-owner-test-2026-11-27/beyond-black-stars-cover.webp"
    }
  ];
  for (const product of products) {
    await catalog.createProduct(database, {
      ...product,
      creatorId: SOURCE.id,
      managedByUserId: SOURCE.userId,
      publicationState: "published",
      shortDescription: product.subtitle,
      status: "preview-only",
      buyMode: "preview-only",
      pricingModel: "fixed",
      priceCents: 0,
      listingVisibility: "unlisted",
      metadata: { testOnly: true, notForSale: true, excludeFromPublicCommercialListings: true, shelvingTest: true }
    }, { nowMs: NOW_MS });
  }

  const migration = fs.readFileSync(migrationPath, "utf8");
  raw.exec("BEGIN;");
  try {
    raw.exec(migration);
    raw.exec("COMMIT;");
  } catch (error) {
    raw.exec("ROLLBACK;");
    throw error;
  }

  const moved = raw.prepare("SELECT id,slug,title,subtitle,creator_id,managed_by_user_id,status,buy_mode,storefront_visibility,price_cents,cover_r2_key,delivery_r2_key FROM marketplace_products WHERE id IN (?,?) ORDER BY id")
    .all(products[0].id, products[1].id);
  assert.equal(moved.length, 2);
  assert.ok(moved.every(product => product.creator_id === TARGET.id && product.managed_by_user_id === TARGET.userId));
  assert.ok(moved.every(product => product.status === "preview-only" && product.buy_mode === "preview-only" && product.storefront_visibility === "unlisted" && product.price_cents === 0 && product.delivery_r2_key === null));
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM creator_test_product_identity_transfers WHERE migration_id='creator-test-product-transfer-082'").get().count, 2);
  assert.throws(() => raw.prepare("UPDATE marketplace_products SET creator_id=? WHERE id=?").run(SOURCE.id, products[0].id), /product identity, slug, and creator are immutable/);
  assert.equal(raw.prepare("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").get().setting_value, "CLOSED");

  const operations = await load("functions/_lib/creator-operations.mjs");
  const memberProfileAccess = await load("functions/_lib/member-profile-access.mjs");
  const profileClass = await memberProfileAccess.resolveMemberProfileAccess(database, { id: TARGET.userId, role: "user" });
  assert.equal(profileClass.accountClass, "creator", "The active standard Creator membership remains a Creator Profile even while marketplace status is pending.");
  const cookie = `__Host-trg_session=${TARGET.session}; trg_account_csrf=${TARGET.csrf}`;
  const identityResponse = await operations.handleCreatorRequest(new Request("https://example.test/api/creator/identity-options", {
    headers: { cookie }
  }), { TRG_ORDERS: database }, { database, nowMs: NOW_MS });
  assert.equal(identityResponse.status, 200);
  const identityOptions = await identityResponse.json();
  assert.deepEqual(identityOptions.creators.map(({ id, permission }) => ({ id, permission })), [{ id: TARGET.id, permission: "manager" }]);
  const response = await operations.handleCreatorRequest(new Request("https://example.test/api/creator/profile-shelf", {
    headers: { cookie: `__Host-trg_session=${TARGET.session}; trg_account_csrf=${TARGET.csrf}` }
  }), { TRG_ORDERS: database }, { database, nowMs: NOW_MS });
  assert.equal(response.status, 200, await response.clone().text());
  const state = await response.json();
  assert.equal(state.catalog.used, 2);
  assert.equal(state.shelf.used, 0);
  assert.equal(state.shelf.limit, 6);
  const returnedById = new Map(state.products.map(product => [product.id, product]));
  for (const product of products) {
    const returned = returnedById.get(product.id);
    assert.deepEqual(
      [returned?.title, returned?.subtitle, returned?.shelved, returned?.coverImage, returned?.public],
      [product.title, product.subtitle, false, `/product-assets/${product.slug}/cover.webp`, false]
    );
  }
  const updateShelf = async productIds => operations.handleCreatorRequest(new Request("https://example.test/api/creator/profile-shelf", {
    method: "POST",
    headers: { origin: "https://example.test", cookie, "x-csrf-token": TARGET.csrf, "content-type": "application/json" },
    body: JSON.stringify({ productIds })
  }), { TRG_ORDERS: database }, { database, nowMs: NOW_MS });
  const readShelf = async () => operations.handleCreatorRequest(new Request("https://example.test/api/creator/profile-shelf", {
    headers: { cookie }
  }), { TRG_ORDERS: database }, { database, nowMs: NOW_MS });
  const shelvedById = state => Object.fromEntries(state.products.map(product => [product.id, product.shelved]));
  let shelfResponse = await updateShelf([products[0].id]);
  assert.equal(shelfResponse.status, 200, await shelfResponse.clone().text());
  let shelfState = await shelfResponse.json();
  assert.deepEqual(shelvedById(shelfState), { [products[0].id]: true, [products[1].id]: false }, "Shelving one title leaves the other unshelved.");
  shelfResponse = await readShelf();
  shelfState = await shelfResponse.json();
  assert.deepEqual(shelvedById(shelfState), { [products[0].id]: true, [products[1].id]: false }, "The independent selection persists after a fresh read.");
  shelfResponse = await updateShelf([products[0].id, products[1].id]);
  assert.equal(shelfResponse.status, 200, await shelfResponse.clone().text());
  shelfState = await shelfResponse.json();
  assert.deepEqual(shelvedById(shelfState), { [products[0].id]: true, [products[1].id]: true });
  shelfResponse = await updateShelf([products[1].id]);
  assert.equal(shelfResponse.status, 200, await shelfResponse.clone().text());
  shelfState = await shelfResponse.json();
  assert.deepEqual(shelvedById(shelfState), { [products[0].id]: false, [products[1].id]: true }, "Removing one title leaves the other shelved.");
  shelfResponse = await updateShelf([]);
  assert.equal(shelfResponse.status, 200, await shelfResponse.clone().text());
  shelfState = await shelfResponse.json();
  assert.deepEqual(shelvedById(shelfState), { [products[0].id]: false, [products[1].id]: false }, "Both products return to the initial unshelved state.");

  raw.close();

  const noOp = new DatabaseSync(":memory:");
  noOp.exec("PRAGMA foreign_keys=ON;");
  noOp.exec(fs.readFileSync(schemaPath, "utf8"));
  if (!noOp.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_profile_shelf_selections'").get()) {
    const shelfMigrationPath = path.join(root, "ops", "releases", "creator-profile-shelf-081", "creator-profile-shelf-081.sql");
    noOp.exec(fs.readFileSync(shelfMigrationPath, "utf8"));
  }
  noOp.exec("BEGIN;");
  try {
    noOp.exec(migration);
    noOp.exec("COMMIT;");
  } catch (error) {
    noOp.exec("ROLLBACK;");
    throw error;
  }
  assert.equal(noOp.prepare("SELECT COUNT(*) count FROM creator_test_product_identity_transfers").get().count, 0,
    "Preview and staging environments without the production-only test records remain unchanged.");
  assert.ok(noOp.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='protect_marketplace_product_identity'").get(),
    "A no-op transfer preserves the immutable product identity trigger.");
  noOp.close();

  console.log("Creator-class test product identity transfer rehearsal passed against the current production schema copy.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
