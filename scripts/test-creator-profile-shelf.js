const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { NOW_MS, CREATOR_A, CREATOR_B, createCreator, creatorRequest, applyMigrations, createD1, load } = require("./test-creator-product-withdrawal.js");
const { createCatalogSlots, sortAndFilterCatalog, createMemberShelfBooks } = require("../assets/js/creator-profile-catalog-layout.js");
const fs = require("node:fs");
const path = require("node:path");
const CREATOR_F = Object.freeze({ id: "creator-profile-shelf-founder", userId: "user-profile-shelf-founder", slug: "profile-shelf-founder", session: "profile-shelf-founder-session", csrf: "profile-shelf-founder-csrf" });
const CREATOR_P = Object.freeze({ id: "creator-profile-shelf-premium", userId: "user-profile-shelf-premium", slug: "profile-shelf-premium", session: "profile-shelf-premium-session", csrf: "profile-shelf-premium-csrf" });

async function main() {
  const emptyStandardSlots = createCatalogSlots([], 12, 12);
  assert.equal(emptyStandardSlots.length, 12, "Empty placeholders represent only unused catalog allowance.");
  const populatedSlots = createCatalogSlots(Array.from({ length: 12 }, (_, index) => ({ id: `slot-${index}` })), 12, 12);
  assert.deepEqual(populatedSlots.slice(0, 12).map(slot => slot.product.id), Array.from({ length: 12 }, (_, index) => `slot-${index}`), "Products fill slots left to right, top to bottom.");
  assert.equal(populatedSlots.slice(12).filter(slot => slot.product).length, 0);
  assert.equal(createCatalogSlots([], 24, 24).length, 24, "Higher catalog tiers receive only their 24 empty catalog placeholders.");
  assert.equal(createCatalogSlots([{ id: "unlimited" }], null, 1).length, 1, "Unlimited catalog accounts render only existing products, not infinite placeholders.");
  const viewProducts = [
    { id: "b", title: "Beta", publishedAt: "2026-02-01", shelved: false, metadata: { series: "North", volume: 2 } },
    { id: "a", title: "Alpha", publishedAt: "2026-01-01", shelved: true, metadata: { series: "North", volume: 1 } },
    { id: "c", title: "Gamma", publishedAt: "2026-03-01", shelved: false, metadata: {} }
  ];
  assert.deepEqual(sortAndFilterCatalog(viewProducts, "title-asc", "all").map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortAndFilterCatalog(viewProducts, "title-desc", "unshelved").map(item => item.id), ["c", "b"],
    "Alphabetical sorting and the unshelved filter combine without changing saved shelf state.");
  assert.deepEqual(sortAndFilterCatalog(viewProducts, "newest", "all").map(item => item.id), ["c", "b", "a"]);
  assert.deepEqual(sortAndFilterCatalog(viewProducts, "oldest", "all").map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortAndFilterCatalog(viewProducts, "series", "shelved").map(item => item.id), ["a"]);
  assert.deepEqual(createMemberShelfBooks([
    { id: "public", title: "Public Book", shelved: true, coverImage: "/public.webp", detailUrl: "/public/" },
    { id: "test-a", title: "The Ashen Grimoire", subtitle: "TEST ITEM • NOT FOR SALE", shelved: true, coverImage: "/ashen.webp", detailUrl: "/ashen/" },
    { id: "test-b", title: "Beyond the Black Stars", shelved: false, coverImage: "/stars.webp", detailUrl: "/stars/" }
  ], "RV Sawyer"), [
    { id: "public", title: "Public Book", subtitle: undefined, detailUrl: "/public/", coverUrl: "/public.webp", creatorName: "RV Sawyer" },
    { id: "test-a", title: "The Ashen Grimoire", subtitle: "TEST ITEM • NOT FOR SALE", detailUrl: "/ashen/", coverUrl: "/ashen.webp", creatorName: "RV Sawyer" }
  ], "The authenticated physical shelf uses only saved private selections, including unlisted test items.");
  const catalogCss = fs.readFileSync(path.join(__dirname, "..", "assets", "css", "creator-profile-shelf.css"), "utf8");
  assert.match(catalogCss, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/, "Desktop title cards use a modest six-column grid.");
  assert.match(catalogCss, /@media\s*\(max-width:\s*700px\)[\s\S]*?grid-template-columns:\s*repeat\(2,/, "Mobile catalog cards reflow to two columns.");
  const profileCss = fs.readFileSync(path.join(__dirname, "..", "assets", "css", "member-profile.css"), "utf8");
  assert.match(profileCss, /member-profile-footer--dashboard\s+p\s*\{[^}]*min-height:\s*1\.35em/, "The Creator Dashboard footer reserves one link line before the link appears.");
  assert.match(profileCss, /member-profile-footer--dashboard\s+\[data-creator-dashboard-link\]\s*\{[^}]*white-space:\s*nowrap/, "The reserved dashboard-link footer stays one line at mobile widths.");
  const creatorPage = fs.readFileSync(path.join(__dirname, "..", "creator", "index.html"), "utf8");
  assert.match(creatorPage, /member-profile-footer--dashboard[^>]*>[\s\S]*?data-creator-dashboard-link hidden/, "The hidden dashboard link starts in its reserved footer below the profile grid.");
  const catalogRenderer = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "creator-profile-shelf.js"), "utf8");
  assert.match(catalogRenderer, /checkbox\.type\s*=\s*"checkbox"/, "Private shelf controls use the requested Shelved checkbox.");
  assert.match(catalogRenderer, /link\.href\s*=\s*product\.detailUrl/, "Occupied title cards link to their existing product detail page.");
  assert.match(catalogRenderer, /if \(product\.subtitle && memberRoot\.dataset\.creatorProfileTier === "creator"\)[\s\S]*?creator-profile-catalog-card__subtitle/, "Only the standard Creator Profile displays the stored TEST / NOT FOR SALE subtitle.");
  assert.match(catalogCss, /\.creator-profile-catalog-card__subtitle\s*\{[^}]*-webkit-line-clamp:\s*2/, "The test label is styled and bounded within the title card.");
  assert.match(catalogRenderer, /renderMemberShelf\(loadedState,\s*publicShelf\.creator\)/, "The authenticated Creator shelf renders from the private shelf state.");
  assert.match(catalogRenderer, /renderMemberShelf\(loadedState,\s*publicState\.creator\)/, "Shelf changes redraw the private shelf from saved state.");
  assert.match(catalogRenderer, /root !== memberRoot \|\| !loadedState/, "A late public response cannot replace authenticated shelf selections.");
  assert.match(catalogRenderer, /catalogRoot\._products\s*=\s*payload\?\.catalog/, "Public catalog products are retained for client-side sorting and filtering.");
  assert.match(catalogRenderer, /identities\.find\(identity => identity\.slug === memberRoot\.dataset\.publicCreatorShelf\)/,
    "The public Creator page reveals private controls only for the matching signed-in Creator identity.");
  assert.match(catalogRenderer, /catalog\.hidden = true/, "The private catalog remains hidden for visitors and non-owners.");
  assert.match(catalogCss, /\.creator-profile-catalog-card--empty/);
  assert.match(catalogCss, /\.creator-profile-public-catalog__cards/);

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
  raw.prepare("UPDATE marketplace_creators SET short_bio='Short bio',long_bio='Creator biography',profile_image='/creator.webp',logo='/logo.webp' WHERE id=?")
    .run(CREATOR_A.id);

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
  assert.deepEqual(publicState.catalog.map(item => item.id), ["shelf-product-0", "shelf-product-1", "shelf-product-2", "shelf-product-3", "shelf-product-4", "shelf-product-5"],
    "Visitors see every available published product, including unshelved products, and no unlisted products.");
  assert.equal(publicState.catalog[0].shelved, true);
  assert.equal(publicState.catalog[1].shelved, false);
  assert.equal(publicState.creator.name, "Mock mock-withdrawal-a");
  assert.equal(publicState.creator.longBio, "Creator biography");
  assert.equal(publicState.creator.profileImage, "/creator.webp");
  assert.ok(publicState.catalog.every(item => item.detailUrl.startsWith("/store/products/")));

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

  const profilePage = fs.readFileSync(path.join(__dirname, "..", "authors", "rv-sawyer", "index.html"), "utf8");
  assert.match(profilePage, /data-public-creator-catalog="rv-sawyer"/);
  assert.match(profilePage, /data-public-creator-shelf="rv-sawyer"[^>]*data-member-creator-shelf/);
  assert.match(profilePage, /data-public-creator-info/);
  for (const route of ["creator", "founding-25-profile", "premium-creator-profile"]) {
    const page = fs.readFileSync(path.join(__dirname, "..", route, "index.html"), "utf8");
    assert.match(page, /data-creator-profile-catalog/);
    assert.match(page, /data-member-creator-info/);
  }
  assert.match(creatorPage, /creator-profile-shelf\.css\?v=creator-profile-shelf6/, "The Creator Profile requests the refreshed test-label styling.");
  assert.match(creatorPage, /creator-profile-shelf\.js\?v=creator-profile-shelf7/, "The Creator Profile requests the refreshed title-card renderer.");
  assert.match(creatorPage, /data-member-creator-shelf data-creator-profile-tier="creator"/, "The test labels are scoped to the standard Creator membership page.");

  raw.close();
  console.log("Creator Profile bookshelf and catalog management tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
