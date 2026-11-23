const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
  console.log("Homepage shelf wiring tests passed.");
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
  const configurationModule = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "homepage-config-d1.mjs")).href);
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

  const upperOpenRulesIds = Array.from({ length: 12 }, (_, index) => `open-rules-upper-${index + 1}`);
  const lowerOpenRulesIds = [];
  const openRulesIds = [...upperOpenRulesIds, ...lowerOpenRulesIds];
  const openRulesConfiguration = configurationModule.defaultHomepageConfiguration();
  openRulesConfiguration.shelves.openRulesLibraryUpper.productIds = upperOpenRulesIds;
  openRulesConfiguration.shelves.openRulesLibraryLower.productIds = lowerOpenRulesIds;
  const openRulesCatalog = openRulesIds.map((id, index) => runtimeProduct(id, 0, {
    id,
    buyMode: "preview-only",
    priceLabel: "",
    status: "preview-only",
    metadata: { openRulesEligible: true, pageCount: 20 + index * 10 }
  }));
  openRulesCatalog.push(runtimeProduct("staging-open-rules-fixture", 0, {
    id: "staging-open-rules-fixture",
    buyMode: "preview-only",
    status: "preview-only",
    metadata: { openRulesEligible: true, pageCount: 12 }
  }));
  const selected = service.selectOpenRulesLibraryProducts(openRulesCatalog, openRulesIds);
  assert.deepEqual(selected.map((product) => product.id), openRulesIds,
    "The Open Rules selector preserves the configured upper-then-lower product order.");
  assert.ok(selected.every((product) => product.priceLabel === "Preview Only"));
  assert.ok(selected.every((product) => product.cover.endsWith("/cover.webp")));
  const configuredShelves = { upper: upperOpenRulesIds, lower: lowerOpenRulesIds };
  const separateShelves = await service.getOpenRulesLibraryShelves(database, openRulesCatalog, configuredShelves);
  assert.deepEqual(separateShelves.upper.map((product) => product.id), upperOpenRulesIds,
    "The upper shelf follows its own configured product order.");
  assert.deepEqual(separateShelves.lower, [],
    "The independently configured lower shelf remains empty when no products are assigned.");
  assert.equal(service.OPEN_RULES_LIBRARY_SHELF_CAPACITY, 18);
  assert.ok(upperOpenRulesIds.length <= service.OPEN_RULES_LIBRARY_SHELF_CAPACITY);
  assert.ok(lowerOpenRulesIds.length <= service.OPEN_RULES_LIBRARY_SHELF_CAPACITY);
  const openRulesResult = await service.getHomepageShelves(database, {
    catalog: openRulesCatalog,
    configuration: openRulesConfiguration
  });
  assert.deepEqual(openRulesResult.shelves.openRulesLibraryUpper.products.map((product) => product.id),
    upperOpenRulesIds);
  assert.deepEqual(openRulesResult.shelves.openRulesLibraryLower.products, []);
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
  const openRules = fs.readFileSync(path.join(ROOT, "assets", "js", "open-rules-library.js"), "utf8");
  const preview = fs.readFileSync(path.join(ROOT, "assets", "js", "guest-product-preview.js"), "utf8");
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  const redirects = fs.readFileSync(path.join(ROOT, "_redirects"), "utf8");
  const dashboard = fs.readFileSync(path.join(ROOT, "creator-dashboard", "index.html"), "utf8");
  assert.match(redirects, /^\/temp-creator\/\s+\/creator-dashboard\/\s+301\s*$/m,
    "The former temporary Dashboard route redirects to the canonical Dashboard.");
  assert.doesNotMatch(redirects, /^\/creator-dashboard\/\s+\/temp-creator\//m,
    "The canonical Dashboard route does not redirect to the former temporary route.");
  assert.match(dashboard, /<link rel="stylesheet" href="\/styles\.css"\s*\/>/,
    "The current Creator Dashboard loads the shared site stylesheet.");
  assert.match(dashboard, /\/assets\/js\/creator-dashboard\.js\?v=/,
    "The current Creator Dashboard loads its dashboard runtime.");
  assert.match(dashboard, /assets\/css\/creator-dashboard\.css/,
    "The current Dashboard retains its compatibility stylesheet entry point.");
  const dashboardCss = fs.readFileSync(path.join(ROOT, "assets", "css", "creator-dashboard.css"), "utf8");
  assert.match(dashboardCss, /@import url\('\/assets\/css\/member-profile\.css'\)/,
    "Dashboard presentation uses the shared Profile stylesheet through the compatibility import.");
  for (const route of [
    "customer-profile", "creator", "founding-25-profile", "premium-creator-profile", "admin-profile", "owner-profile"
  ]) {
    const profile = fs.readFileSync(path.join(ROOT, route, "index.html"), "utf8");
    assert.match(profile, /href="\/assets\/css\/member-profile\.css(?:\?v=[^"]+)?"/,
      `${route} uses the shared Member Profile stylesheet directly.`);
  }
  for (const [label, pagePath] of [["Guest", "guest/index.html"], ["Customer", "customer.html"]]) {
    const page = fs.readFileSync(path.join(ROOT, pagePath), "utf8");
    assert.match(page, /href="\/styles\.css(?:\?v=[^"]+)?"/,
      `${label} loads the shared stylesheet that presents Open Rules shelves.`);
    assert.match(page, /src="\/assets\/js\/open-rules-library\.js\?v=[^"]+" defer/,
      `${label} loads the shared Open Rules book renderer.`);
    assert.match(page, /src="\/assets\/js\/homepage-shelves\.js\?v=[^"]+" defer/,
      `${label} loads the shelf hydration runtime.`);
  }
  assert.match(client, /\/api\/homepage-shelves/);
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
  assert.match(openRules, /function fitSpineTitle\(title\)[\s\S]*?const available = title\.clientHeight;[\s\S]*?const content = title\.scrollHeight;[\s\S]*?--open-rules-title-scale/);
  assert.match(styles, /\.homepage-open-rules-book__product \.product-book__spine-title[\s\S]*?white-space: nowrap;[\s\S]*?scaleY\(var\(--open-rules-title-scale, 1\)\)[\s\S]*?text-overflow: clip;/);
  assert.match(preview, /guestPreviewBound/);
  assert.match(preview, /realProductLink/);
  assert.match(preview, /trg:homepage-shelves-updated/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
