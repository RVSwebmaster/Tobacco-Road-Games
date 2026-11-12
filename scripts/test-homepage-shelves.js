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

  const openRulesCatalog = service.OPEN_RULES_LIBRARY_PRODUCT_IDS.map((id, index) => runtimeProduct(id, 0, {
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
  const selected = service.selectOpenRulesLibraryProducts(openRulesCatalog);
  assert.deepEqual(selected.map((product) => product.id), service.OPEN_RULES_LIBRARY_PRODUCT_IDS,
    "The Open Rules shelf must use only the twelve approved D1 identities in their editorial order.");
  assert.ok(selected.every((product) => product.priceLabel === "Preview Only"));
  assert.ok(selected.every((product) => product.cover.endsWith("/cover.webp")));
  const separateShelves = await service.getOpenRulesLibraryShelves(database, openRulesCatalog);
  assert.deepEqual(separateShelves.upper.map((product) => product.id), service.OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS,
    "All current Open Rules publications should occupy the independent upper shelf.");
  assert.deepEqual(separateShelves.lower, [],
    "The independent lower shelf should remain available for future publications.");
  assert.equal(service.OPEN_RULES_LIBRARY_SHELF_CAPACITY, 18);
  assert.ok(service.OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS.length <= service.OPEN_RULES_LIBRARY_SHELF_CAPACITY);
  assert.ok(service.OPEN_RULES_LIBRARY_LOWER_PRODUCT_IDS.length <= service.OPEN_RULES_LIBRARY_SHELF_CAPACITY);
  const openRulesResult = await service.getHomepageShelves(database, { catalog: openRulesCatalog });
  assert.deepEqual(openRulesResult.shelves.openRulesLibraryUpper.products.map((product) => product.id),
    service.OPEN_RULES_LIBRARY_UPPER_PRODUCT_IDS);
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
  const preview = fs.readFileSync(path.join(ROOT, "assets", "js", "guest-product-preview.js"), "utf8");
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"));
  assert.match(client, /\/api\/homepage-shelves/);
  assert.ok(routes.include.includes("/api/homepage-shelves"), "The public homepage shelf Function must be included in Pages routing.");
  assert.match(client, /slice\(0, 43\)/);
  assert.match(client, /trg:homepage-shelves-updated/);
  assert.match(client, /dataset\.guestProductPreview/);
  assert.match(client, /readExistingProducts/);
  assert.match(client, /suppressedSlugs/);
  assert.match(client, /openRulesLibraryUpper/);
  assert.match(client, /openRulesLibraryLower/);
  assert.match(client, /homepage-open-rules-book/);
  assert.match(client, /products\.slice\(0, 18\)/);
  assert.match(client, /hydrateGuestOpenRulesShelf/);
  assert.match(client, /depthForPages\(pageCount\) \* 188 \/ 340/);
  assert.match(client, /guest-open-rules-real-book/);
  assert.match(client, /removeAttribute\("data-mock-open-rule"\)/);
  assert.match(client, /--open-rules-spine-ratio/);
  assert.match(client, /guest-open-rules-real-book__link/);
  const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.match(styles, /\.shop-wall-library-books > \.homepage-open-rules-book[\s\S]*?--open-rules-spine-width/);
  assert.match(preview, /guestPreviewBound/);
  assert.match(preview, /realProductLink/);
  assert.match(preview, /trg:homepage-shelves-updated/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
