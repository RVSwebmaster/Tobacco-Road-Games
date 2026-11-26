const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { NOW_MS, CREATOR_A, CREATOR_B, createCreator, creatorRequest, applyMigrations, createD1, load } = require("./test-creator-product-withdrawal.js");
const CREATOR_F = Object.freeze({ id: "creator-profile-shelf-founder", userId: "user-profile-shelf-founder", slug: "profile-shelf-founder", session: "profile-shelf-founder-session", csrf: "profile-shelf-founder-csrf" });
const CREATOR_P = Object.freeze({ id: "creator-profile-shelf-premium", userId: "user-profile-shelf-premium", slug: "profile-shelf-premium", session: "profile-shelf-premium-session", csrf: "profile-shelf-premium-csrf" });

async function main() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  applyMigrations(raw);
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_commission_category_assignments'").get()) {
    raw.exec(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "ops", "releases", "account-profile-072", "account-profile-072.sql"), "utf8"));
  }
  const auth = await load("functions/_lib/account-auth.mjs");
  const creatorOperations = await load("functions/_lib/creator-operations.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const publicShelf = await load("functions/_lib/creator-profile-public-shelf.mjs");
  await createCreator(raw, auth, CREATOR_A);
  await createCreator(raw, auth, CREATOR_B);
  await createCreator(raw, auth, CREATOR_F);
  await createCreator(raw, auth, CREATOR_P);
  const now = new Date(NOW_MS).toISOString();
  raw.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES('profile-shelf-founding25',?,'founding25',?,?,?,?)")
    .run(CREATOR_F.id, now, CREATOR_A.userId, "Profile shelf capacity verification", now);
  raw.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES('profile-shelf-premium',?,'annual_prepaid',20000,?,?,'renews','active',?,?)")
    .run(CREATOR_P.id, new Date(NOW_MS - 1000).toISOString(), new Date(NOW_MS + 365 * 86400000).toISOString(), now, now);
  const db = createD1(raw), env = { TRG_ORDERS: db }, options = { database: db, nowMs: NOW_MS };

  for (let index = 0; index < 7; index++) {
    await catalog.createProduct(db, {
      id: `shelf-product-${index}`,
      slug: `shelf-product-${index}`,
      creatorId: CREATOR_A.id,
      managedByUserId: CREATOR_A.userId,
      publicationState: "published",
      title: `Shelf Test Product ${index}`,
      status: "available-direct",
      buyMode: "cart",
      pricingModel: "fixed",
      priceCents: 500,
      listingVisibility: index < 6 ? "listed" : "unlisted",
      coverR2Key: `catalog-publications/shelf-product-${index}/cover.webp`,
      metadata: {}
    }, { nowMs: NOW_MS });
  }
  await catalog.createProduct(db, {
    id: "other-creators-product",
    slug: "other-creators-product",
    creatorId: CREATOR_B.id,
    managedByUserId: CREATOR_B.userId,
    publicationState: "published",
    title: "Other Creator Product",
    status: "available-direct",
    buyMode: "cart",
    pricingModel: "fixed",
    priceCents: 700,
    listingVisibility: "listed",
    coverR2Key: "catalog-publications/other/cover.webp",
    metadata: {}
  }, { nowMs: NOW_MS });

  const getState = (creator, query = "") => creatorOperations.handleCreatorRequest(
    new Request(`https://example.com/api/creator/profile-shelf${query}`, {
      headers: { cookie: `__Host-trg_session=${creator.session}; trg_account_csrf=${creator.csrf}` }
    }), env, options
  );
  for (const [creator, catalogLimit, shelfLimit] of [[CREATOR_A, 12, 6], [CREATOR_F, 24, 12], [CREATOR_P, 24, 12]]) {
    const response = await getState(creator);
    assert.equal(response.status, 200);
    const allowance = await response.json();
    assert.equal(allowance.catalog.limit, catalogLimit, `${creator.slug} receives the configured catalog allowance.`);
    assert.equal(allowance.shelf.limit, shelfLimit, `${creator.slug} receives the configured shelf allowance.`);
  }
  let response = await getState(CREATOR_A);
  assert.equal(response.status, 200, await response.clone().text());
  let state = await response.json();
  assert.equal(state.catalog.used, 7);
  assert.equal(state.catalog.limit, 12);
  assert.equal(state.shelf.used, 0);
  assert.equal(state.shelf.limit, 6);
  assert.equal(state.products.length, 7, "The private desk includes all owned catalog products.");
  assert.ok(state.products.some(item => item.id === "shelf-product-6" && item.public === false));

  response = await creatorOperations.handleCreatorRequest(creatorRequest(CREATOR_A, "profile-shelf", {
    productIds: ["shelf-product-0", "shelf-product-6"]
  }), env, options);
  assert.equal(response.status, 200, await response.clone().text());
  state = await response.json();
  assert.equal(state.shelf.used, 2);
  assert.deepEqual(state.productIds, ["shelf-product-0", "shelf-product-6"]);
  assert.equal(raw.prepare("SELECT storefront_visibility FROM marketplace_products WHERE id='shelf-product-0'").get().storefront_visibility, "listed",
    "Profile shelving does not change marketplace listing visibility.");
  assert.equal(raw.prepare("SELECT storefront_visibility FROM marketplace_products WHERE id='shelf-product-6'").get().storefront_visibility, "unlisted");

  const publicRequest = slug => publicShelf.handlePublicCreatorShelfRequest(
    new Request(`https://example.com/api/public/creator-shelf?creatorSlug=${slug}`), env
  );
  response = await publicRequest(CREATOR_A.slug);
  assert.equal(response.status, 200);
  const publicState = await response.json();
  assert.deepEqual(publicState.products.map(item => item.id), ["shelf-product-0"],
    "Only selected, published, listed, purchase-eligible products are visible to visitors.");
  assert.equal(publicState.products[0].coverUrl, "/product-assets/shelf-product-0/cover.webp");

  response = await getState(CREATOR_A);
  state = await response.json();
  assert.deepEqual(state.productIds, ["shelf-product-0", "shelf-product-6"], "Shelf assignments persist after a fresh read.");
  assert.equal(state.shelf.used, 2);

  response = await creatorOperations.handleCreatorRequest(creatorRequest(CREATOR_A, "profile-shelf", {
    productIds: ["shelf-product-0", "shelf-product-1", "shelf-product-2", "shelf-product-3", "shelf-product-4", "shelf-product-5", "shelf-product-6"]
  }), env, options);
  assert.equal(response.status, 409, "The existing tier shelf allowance is enforced on the server.");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM creator_profile_shelf_selections WHERE creator_id=?").get(CREATOR_A.id).count, 2,
    "A rejected capacity change leaves the prior assignments intact.");

  response = await creatorOperations.handleCreatorRequest(creatorRequest(CREATOR_A, "profile-shelf", {
    productIds: ["other-creators-product"]
  }), env, options);
  assert.equal(response.status, 403, "A Creator cannot shelf another Creator's catalog product.");

  response = await getState(CREATOR_B, `?creator=${CREATOR_A.id}`);
  assert.equal(response.status, 403, "A different Creator cannot read the private catalog desk.");

  response = await creatorOperations.handleCreatorRequest(new Request("https://example.com/api/creator/profile-shelf"), {}, options);
  assert.equal(response.status, 401, "Signed-out visitors cannot access private shelf management.");

  raw.close();
  console.log("Creator Profile bookshelf and catalog management tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
