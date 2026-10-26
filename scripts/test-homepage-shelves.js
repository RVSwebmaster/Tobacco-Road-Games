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
  assert.deepEqual(result.bestSellers.map((product) => product.slug), ["high-dollar", "free-book", "second"], "Service should preserve D1 sales ranking while dropping ineligible catalog records.");
  assert.equal(result.windowDays, 30);
  assert.match(capturedSql, /SUM\(oi\.line_total_cents\)/);
  assert.match(capturedSql, /ORDER BY sales_cents DESC/);
  assert.match(capturedSql, /payment_status = 'paid'/);
  assert.match(capturedSql, /NOT LIKE '%test%'/);
  assert.equal(capturedBindings[1], 43, "Best Sellers query must cap the homepage shelf at 43 products.");
}

function runtimeProduct(slug, cents, overrides = {}) {
  return {
    slug,
    title: slug,
    authorDisplay: "RV Sawyer",
    publisher: "Tobacco Road Games",
    buyMode: "cart",
    coverUrl: `/product-assets/${slug}/cover.webp`,
    currency: "USD",
    effectivePriceCents: cents,
    shortDescription: "Catalog product",
    status: "available-direct",
    ...overrides
  };
}

function testClientWiring() {
  const client = fs.readFileSync(path.join(ROOT, "assets", "js", "homepage-shelves.js"), "utf8");
  const preview = fs.readFileSync(path.join(ROOT, "assets", "js", "guest-product-preview.js"), "utf8");
  assert.match(client, /\/api\/homepage-shelves/);
  assert.match(client, /slice\(0, 43\)/);
  assert.match(client, /trg:homepage-shelves-updated/);
  assert.match(client, /dataset\.guestProductPreview/);
  assert.match(preview, /guestPreviewBound/);
  assert.match(preview, /realProductLink/);
  assert.match(preview, /trg:homepage-shelves-updated/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
