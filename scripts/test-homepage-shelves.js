const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const {
  renderHomepageMerchandisingBooks,
  selectNewThisWeek
} = require("./build-store.js");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  testNewThisWeekWindow();
  testRealPreviewMarkup();
  await testBestSellerService();
  testClientWiring();
  testManagedOpenRulesPayloadValidation();
  console.log("Homepage shelf wiring tests passed.");
}

function testManagedOpenRulesPayloadValidation() {
  const client = fs.readFileSync(path.join(ROOT, "assets", "js", "homepage-shelves.js"), "utf8");
  const rows = [makeShelfRow(), makeShelfRow()];
  const bay = {
    hidden: false,
    querySelectorAll(selector) { return selector === ".guest-open-rules-books" ? rows : []; }
  };
  const resizeObservers = [];
  const shelfEvents = [];
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      if (selector === ".creator-dashboard-open-rules-bay") return {};
      return selector === '[aria-labelledby="open-rules-library-heading"]' ? bay : null;
    },
    dispatchEvent(event) { shelfEvents.push(event); }
  };
  const window = {
    innerWidth: 1200,
    addEventListener() {},
    TRGOpenRulesLibrary: {
      createOpenRulesShelfBook(product) { return { slug: product.slug, id: product.id }; }
    }
  };
  class MockResizeObserver {
    constructor(callback) { this.callback = callback; resizeObservers.push(this); }
    observe() {}
  }
  const context = { window, document, ResizeObserver: MockResizeObserver, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } };
  vm.runInNewContext(client, context, { filename: "homepage-shelves.js" });
  const api = window.TRGHomepageShelves;
  const product = (id) => ({ id, slug: id, title: id, fullUrl: `/store/products/${id}/`, metadata: {} });
  const shelf = (products, overrides = {}) => ({ managed: true, visible: true, products, ...overrides });
  const validEmpty = shelf([]);

  assert.equal(api.hydrateOpenRulesLibrary(shelf(Array.from({ length: 13 }, (_, index) => product(`book-${index + 1}`))), validEmpty), true);
  assert.deepEqual(rows[0].children.map((book) => book.id), Array.from({ length: 13 }, (_, index) => `book-${index + 1}`),
    "The populated managed shelf must render every selected product in server order.");
  assert.deepEqual(rows[1].children, [], "A valid managed empty lower shelf must remain empty.");
  assert.equal(shelfEvents.length, 2, "Initial managed shelf rendering announces both rendered rows.");
  resizeObservers[0].callback();
  assert.equal(shelfEvents.length, 3, "Books rebuilt after resize announce the replacement nodes so delegated page behavior can rebind.");
  assert.equal(shelfEvents[2].detail.count, 13, "Resize update reports the rendered product count.");

  const reordered = [product("book-3"), product("book-1"), product("book-2")];
  assert.equal(api.hydrateOpenRulesLibrary(shelf(reordered), validEmpty), true);
  assert.deepEqual(rows[0].children.map((book) => book.id), ["book-3", "book-1", "book-2"],
    "A changed configured product order must be respected.");

  assert.equal(api.hydrateOpenRulesLibrary(validEmpty, validEmpty), true);
  assert.deepEqual(rows.map((row) => row.children), [[], []], "A valid managed empty collection intentionally clears both shelves.");

  const restoreBooks = () => rows.forEach((row, index) => { row.children = [`existing-${index}`]; });
  const existing = () => rows.map((row) => row.children.slice());
  const malformedCases = [
    [undefined, validEmpty],
    [shelf([product("candidate")]), undefined],
    [{ managed: true, visible: true }, validEmpty],
    [shelf([product("new-upper")]), { managed: true, visible: true }],
    [shelf([{ id: "broken", slug: "broken", title: 7, fullUrl: "/broken" }]), validEmpty]
  ];
  for (const [upper, lower] of malformedCases) {
    restoreBooks();
    const before = existing();
    assert.equal(api.hydrateOpenRulesLibrary(upper, lower), false, "Malformed or partial managed shelf data must be rejected.");
    assert.deepEqual(existing(), before, "Malformed data must not alter any existing shelf contents.");
  }

  restoreBooks();
  const beforeUnavailable = existing();
  api.hydratePayload({ unavailable: true, shelves: { openRulesLibraryUpper: validEmpty, openRulesLibraryLower: validEmpty } });
  assert.deepEqual(existing(), beforeUnavailable, "An unavailable API response must preserve existing books.");

  api.hydratePayload({ shelves: { openRulesLibraryUpper: validEmpty } });
  assert.deepEqual(existing(), beforeUnavailable, "A partial API response missing one shelf must preserve both rendered rows.");
  api.hydratePayload({ shelves: { openRulesLibraryUpper: shelf([product("candidate")]), openRulesLibraryLower: { managed: true, visible: true } } });
  assert.deepEqual(existing(), beforeUnavailable, "A malformed managed shelf in a partial API response must preserve both rendered rows.");

  restoreBooks();
  const beforeUnmanaged = existing();
  assert.equal(api.hydrateOpenRulesLibrary({ managed: false, visible: true }, { managed: false, visible: true }), true);
  assert.deepEqual(existing(), beforeUnmanaged, "Unmanaged shelves must preserve their current rendered content.");
}

function makeShelfRow() {
  return {
    children: ["initial-book"],
    style: { setProperty() {} },
    parentElement: {},
    getBoundingClientRect() { return { width: 240 }; },
    replaceChildren(...children) { this.children = children; }
  };
}

function testNewThisWeekWindow() {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const products = [
    { slug: "today", title: "Today", releaseStamp: Date.parse("2026-10-26T00:00:00Z"), updatedStamp: 0 },
    { slug: "six-days", title: "Six Days", releaseStamp: Date.parse("2026-10-20T00:00:00Z"), updatedStamp: 0 },
    { slug: "eight-days", title: "Eight Days", releaseStamp: Date.parse("2026-10-18T00:00:00Z"), updatedStamp: 0 },
    { slug: "future", title: "Future", releaseStamp: Date.parse("2026-10-27T00:00:00Z"), updatedStamp: 0 }
  ];
  assert.deepEqual(
    selectNewThisWeek(products, now).map((product) => product.slug),
    ["today", "six-days"],
    "New This Week should contain only releases from the previous seven days and never future releases."
  );
}

function testRealPreviewMarkup() {
  const product = {
    slug: "real-book",
    title: "Real Book",
    subtitle: "",
    authors: ["RV Sawyer"],
    authorSlugs: ["rv-sawyer"],
    publisher: "Tobacco Road Games",
    status: "available-direct",
    statusLabel: "Available Direct",
    buyMode: "cart",
    priceType: "fixed-price",
    priceTypeLabel: "Fixed Price",
    priceCents: 499,
    effectivePriceCents: 499,
    currency: "USD",
    shortDescription: "A real catalog product.",
    format: ["PDF"],
    tags: [],
    gameSystem: "5E Compatible",
    gameSystemSlug: "5e-compatible",
    productLine: "TRG",
    productLineSlug: "trg",
    series: "",
    seriesSlug: "",
    releaseStamp: Date.parse("2026-10-26T00:00:00Z"),
    updatedStamp: Date.parse("2026-10-26T00:00:00Z"),
    saleActive: false,
    assetSet: { cover: "/product-assets/real-book/cover.webp" },
    url: "/store/products/real-book/"
  };
  const html = renderHomepageMerchandisingBooks([product], null, { liveShelf: "best-sellers" });
  assert.match(html, /data-live-homepage-shelf="best-sellers"/);
  assert.match(html, /data-guest-product-preview="/);
  assert.match(html, /real-book/);
  assert.match(html, /A real catalog product./);
}

async function testBestSellerService() {
  const modulePath = pathToFileURL(path.join(ROOT, "functions", "_lib", "homepage-shelves.mjs")).href + "?test=homepage-shelves";
  const service = await import(modulePath);
  const configPath = pathToFileURL(path.join(ROOT, "functions", "_lib", "homepage-config-d1.mjs")).href;
  const configurationModule = await import(configPath);
  let capturedSql = "";
  let capturedBindings = [];
  const database = {
    prepare(sql) {
      capturedSql = sql;
      return {
        bind(...values) {
          capturedBindings = values;
          return this;
        },
        async all() {
          return {
            results: [
              { product_slug: "high-dollar", sales_cents: 9000, paid_orders: 3 },
              { product_slug: "free-book", sales_cents: 0, paid_orders: 8 },
              { product_slug: "second", sales_cents: 5000, paid_orders: 5 },
              { product_slug: "retired-book", sales_cents: 4000, paid_orders: 2 }
            ]
          };
        }
      };
    }
  };
  const catalog = [
    runtimeProduct("high-dollar", 1200),
    runtimeProduct("second", 800),
    runtimeProduct("free-book", 0, { buyMode: "free-download" }),
    runtimeProduct("retired-book", 700, { buyMode: "retired", status: "legacy-not-for-sale" })
  ];
  const result = await service.getHomepageShelves(database, {
    catalog,
    nowMs: Date.parse("2026-10-26T12:00:00Z"),
    windowDays: 30,
    limit: 43
  });
  assert.deepEqual(result.bestSellers.map((product) => product.slug), ["high-dollar", "second"], "Service should preserve D1 sales ranking while dropping zero-dollar and ineligible catalog records.");
  assert.equal(result.windowDays, 30);
  assert.match(capturedSql, /SUM\(oi\.line_total_cents\)/);
  assert.match(capturedSql, /ORDER BY sales_cents DESC/);
  assert.match(capturedSql, /payment_status = 'paid'/);
  assert.match(capturedSql, /NOT LIKE '%test%'/);
  assert.equal(capturedBindings[1], 43, "Best Sellers query must cap the homepage shelf at 43 products.");

  const configuredOpenRulesIds = [
    "5e-players-manual", "5e-spellbook", "5e-bard-spellbook", "5e-cleric-spellbook",
    "5e-druid-spellbook", "5e-paladin-spellbook", "5e-ranger-spellbook",
    "5e-sorcerer-spellbook", "5e-warlock-spellbook", "5e-wizard-spellbook",
    "5e-relics-and-wonders", "5e-dungeon-masters-handbook", "5e-monster-guide"
  ];
  const openRulesCatalog = configuredOpenRulesIds.map((id, index) => runtimeProduct(id, 0, {
    id,
    buyMode: "preview-only",
    priceLabel: "",
    status: "preview-only",
    metadata: { openRulesEligible: true, pageCount: 20 + index * 10 }
  }));
  openRulesCatalog.push(runtimeProduct("ineligible-open-rules-fixture", 0, {
    id: "ineligible-open-rules-fixture",
    buyMode: "preview-only",
    status: "preview-only",
    metadata: { openRulesEligible: false, pageCount: 12 }
  }));
  openRulesCatalog.push(runtimeProduct("retired-open-rules-fixture", 0, {
    id: "retired-open-rules-fixture",
    buyMode: "retired",
    status: "retired",
    metadata: { openRulesEligible: true, pageCount: 12 }
  }));
  const configuredWithExcluded = [...configuredOpenRulesIds, "ineligible-open-rules-fixture", "retired-open-rules-fixture"];
  const selected = service.selectOpenRulesLibraryProducts(openRulesCatalog, configuredWithExcluded);
  assert.deepEqual(selected.map((product) => product.id), configuredOpenRulesIds,
    "The Open Rules shelf must preserve configured order while excluding ineligible and retired products.");
  assert.ok(selected.every((product) => product.priceLabel === "Preview Only"));
  assert.ok(selected.every((product) => product.cover.endsWith("/cover.webp")));
  const configured = { upper: configuredWithExcluded, lower: [] };
  const separateShelves = await service.getOpenRulesLibraryShelves(database, openRulesCatalog, configured);
  assert.deepEqual(separateShelves.upper.map((product) => product.id), configuredOpenRulesIds,
    "Configured Open Rules publications should retain their ordered upper-shelf placement.");
  assert.deepEqual(separateShelves.lower, [],
    "The independent lower shelf should remain available for future publications.");
  assert.equal(service.OPEN_RULES_LIBRARY_SHELF_CAPACITY, 18);
  const configuration = configurationModule.defaultHomepageConfiguration();
  configuration.shelves.openRulesLibraryUpper.productIds = configuredWithExcluded;
  const openRulesResult = await service.getHomepageShelves(database, { catalog: openRulesCatalog, configuration });
  assert.deepEqual(openRulesResult.shelves.openRulesLibraryUpper.products.map((product) => product.id),
    configuredOpenRulesIds);
  assert.deepEqual(openRulesResult.shelves.openRulesLibraryLower.products, []);

  const reorderedIds = [configuredOpenRulesIds[2], configuredOpenRulesIds[0], configuredOpenRulesIds[1]];
  const reorderedConfiguration = configurationModule.defaultHomepageConfiguration();
  reorderedConfiguration.shelves.openRulesLibraryUpper.productIds = reorderedIds;
  const reordered = await service.getHomepageShelves(database, {
    catalog: openRulesCatalog,
    configuration: reorderedConfiguration
  });
  assert.deepEqual(reordered.shelves.openRulesLibraryUpper.products.map((product) => product.id), reorderedIds,
    "A changed D1 shelf order must be used exactly.");

  const empty = await service.getHomepageShelves(database, {
    catalog: openRulesCatalog,
    configuration: configurationModule.defaultHomepageConfiguration()
  });
  assert.deepEqual(empty.shelves.openRulesLibraryUpper.products, [],
    "An empty D1 Open Rules configuration must not fall back to a hardcoded product list.");
}

function runtimeProduct(slug, cents, overrides = {}) {
  return {
    slug,
    title: slug,
    creator: "RV Sawyer",
    buyMode: "cart",
    cover: `/product-assets/${slug}/cover.webp`,
    priceLabel: cents === 0 ? "Free Download" : `${(cents / 100).toFixed(2)}`,
    description: "Catalog product",
    fullUrl: `/store/products/${slug}/`,
    status: "available-direct",
    ...overrides
  };
}

function testClientWiring() {
  const client = fs.readFileSync(path.join(ROOT, "assets", "js", "homepage-shelves.js"), "utf8");
  const endpoint = fs.readFileSync(path.join(ROOT, "functions", "api", "homepage-shelves.js"), "utf8");
  const openRules = fs.readFileSync(path.join(ROOT, "assets", "js", "open-rules-library.js"), "utf8");
  const preview = fs.readFileSync(path.join(ROOT, "assets", "js", "guest-product-preview.js"), "utf8");
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.match(client, /\/api\/homepage-shelves/);
  assert.match(client, /fetch\("\/api\/homepage-shelves", \{ cache: "default", credentials: "same-origin" \}\)/);
  assert.match(endpoint, /json\(shelves, 200, "public, max-age=60"\)/);
  assert.match(endpoint, /if \(!shelves \|\| shelves\.unavailable === true\)[\s\S]*?return json\(shelves \|\| \{ bestSellers: \[\], unavailable: true \}, 200\)/);
  assert.match(endpoint, /function json\(body, status, cacheControl = "no-store"\)/);
  assert.match(endpoint, /catch \{\s*return json\(\{ bestSellers: \[\], windowDays: 30, unavailable: true \}, 200\);/);
  const shelfLibrary = fs.readFileSync(path.join(ROOT, "functions", "_lib", "homepage-shelves.mjs"), "utf8");
  assert.match(shelfLibrary, /configurationRecord\.unavailable \? \{ unavailable: true \} : \{\}/);
  assert.match(shelfLibrary, /catch \{ return \{ configuration: defaultHomepageConfiguration\(\), revision: 0, unavailable: true \}; \}/);
  assert.ok(routes.include.includes("/api/homepage-shelves"), "The public homepage shelf Function must be included in Pages routing.");
  assert.match(client, /slice\(0, 43\)/);
  assert.match(client, /trg:homepage-shelves-updated/);
  assert.match(client, /dataset\.guestProductPreview/);
  assert.match(client, /readExistingProducts/);
  assert.match(client, /suppressedSlugs/);
  assert.match(client, /openRulesLibraryUpper/);
  assert.match(client, /openRulesLibraryLower/);
  assert.match(client, /TRGOpenRulesLibrary/);
  assert.match(openRules, /function createOpenRulesShelfBook\(product, position = 0, baseWidth = 12\)/);
  assert.match(openRules, /const heights = \[79, 86, 72\]/);
  assert.doesNotMatch(openRules, /function createOpenRulesSpine|function createGuestOpenRulesBook/);
  assert.match(openRules, /products?\.metadata/);
  assert.match(client, /buildOpenRulesShelfBooks/);
  assert.match(client, /createOpenRulesShelfBook/);
  assert.match(openRules, /homepage-open-rules-book__rotation/);
  assert.match(openRules, /--book-angle/, "Shelf books must use the rendered rotation angle.");
  assert.match(openRules, /panel\.className = "product-book__spine-art"/);
  assert.match(openRules, /product-book__back/);
  assert.match(openRules, /title\.className = "product-book__spine-title"/);
  assert.match(openRules, /credit\.className = "product-book__spine-credit"/);
  const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.match(styles, /\.shop-wall-library-books > \.homepage-open-rules-book[\s\S]*?--open-rules-spine-width/);
  assert.match(styles, /\.homepage-open-rules-book:hover[\s\S]*?translateY\(-10px\)/);
  assert.match(styles, /height: var\(--mock-book-height, 82%\)/);
  assert.match(openRules, /function fitSpineTitle\(title\)[\s\S]*?const available = title\.clientHeight;[\s\S]*?const content = title\.scrollHeight;[\s\S]*?--open-rules-title-scale/,
    "Long spine titles must be fitted to the rendered title area.");
  assert.match(styles, /\.homepage-open-rules-book__product \.product-book__spine-title[\s\S]*?white-space: nowrap;[\s\S]*?scaleY\(var\(--open-rules-title-scale, 1\)\)[\s\S]*?text-overflow: clip;/,
    "Complete Open Rules titles must remain single-column and must not be ellipsized.");
  const creatorStyles = fs.readFileSync(path.join(ROOT, "assets", "css", "creator-dashboard.css"), "utf8");
  assert.doesNotMatch(creatorStyles, /\.homepage-open-rules-book:hover/);
  assert.match(creatorStyles, /\.creator-dashboard-open-rules-bay \.shop-wall-library-books[\s\S]*?overflow: visible/);
  assert.match(creatorStyles, /\.creator-dashboard-open-rules-bay \.homepage-open-rules-book__rotation[\s\S]*?overflow: visible/);
  assert.match(preview, /guestPreviewBound/);
  assert.match(preview, /realProductLink/);
  assert.match(preview, /trg:homepage-shelves-updated/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
