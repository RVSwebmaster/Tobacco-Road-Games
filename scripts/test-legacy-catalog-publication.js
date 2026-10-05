const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const DIRECT_PRODUCTS = ["agency", "circle-of-cinder", "janni", "ringbound", "tablecraft-primer"];
const REMOVED = [
  "sirrocans",
  "spriggans",
  "final-flame",
  "mouthy-monsters",
  "path-of-the-janky",
  "yojimbo",
  "silence-and-the-spotlight"
];
const SALEABLE_STATUSES = new Set(["available-direct", "free-download", "pay-what-you-want"]);
const SALEABLE_BUY_MODES = new Set(["cart", "fixed-price", "free-download", "manual-invoice", "pay-what-you-want"]);

async function main() {
  const products = JSON.parse(read("data/products.json"));
  const productMap = new Map(products.map((product) => [product.slug, product]));
  const migration = read("migrations/018_creator_operations.sql");
  const seededSlugs = [...migration.matchAll(/'listing-[^']+','creator-rv-sawyer','([^']+)','([^']+)'/g)]
    .map((match) => match[2]);

  assert.equal(seededSlugs.length, 12, "The compatibility inventory should retain every migration-seeded D1 listing.");
  for (const slug of DIRECT_PRODUCTS) {
    const product = productMap.get(slug);
    assert.ok(product, `${slug} should retain its static product record.`);
    assert.equal(SALEABLE_STATUSES.has(product.status), true, `${slug} should use a saleable status.`);
    assert.equal(SALEABLE_BUY_MODES.has(product.buyMode), true, `${slug} should use a saleable buy mode.`);
  }

  for (const slug of DIRECT_PRODUCTS) {
    const product = productMap.get(slug);
    assert.equal(product.status, "available-direct");
    assert.notEqual(product.buyMode, "retired");
    assert.equal(product.saleEnabled, false);

    const directPage = read(`store/products/${slug}/index.html`);
    assert.match(directPage, /Available Direct/);
    assert.match(directPage, new RegExp(`data-cart-add=["']${slug}["']`));

    for (const activePage of ["store/index.html", "store/catalog/index.html", "store/sitemap.xml"]) {
      assert.match(read(activePage), new RegExp(`/store/products/${slug}/`), `${slug} should appear in ${activePage}.`);
    }
  }

  const activePages = [
    "authors/rv-sawyer/index.html",
    "store/index.html",
    "store/catalog/index.html",
    "store/cart/index.html",
    "store/sitemap.xml",
    "shared/runtime-catalog.mjs"
  ];
  for (const slug of REMOVED) {
    assert.equal(seededSlugs.includes(slug), true, `${slug} should remain a dormant D1 compatibility seed.`);
    assert.equal(productMap.has(slug), false, `${slug} must be absent from the static product source.`);
    assert.equal(fs.existsSync(path.join(ROOT, "store", "products", slug, "index.html")), false, `${slug} must not have a generated product page.`);
    for (const activePage of activePages) {
      assert.doesNotMatch(read(activePage), new RegExp(slug), `${slug} must stay out of ${activePage}.`);
    }
  }

  const homepage = JSON.parse(read("data/homepage.json"));
  assert.equal(REMOVED.includes(homepage.featuredSlug), false);
  assert.deepEqual(homepage.workInProgressSlugs.filter((slug) => REMOVED.includes(slug)), []);

  assert.match(read("functions/_lib/cart-checkout.mjs"), /publication_state!=='published'/, "Checkout must continue rejecting unpublished Creator listings.");

  const publication = await import(pathToFileURL(path.join(ROOT, "functions/_lib/creator-publication-map.mjs")).href);
  const mapped = publication.mapApprovedListingToPublishPayload({
    id: "listing-published-fixture",
    slug: "published-fixture",
    title: "Published Fixture",
    short_description: "A current listing.",
    long_description: "A current listing that completed publication review.",
    game_system: "System Neutral",
    format_json: '["PDF"]',
    listed_price_cents: 500,
    media_type: "digital",
    publication_state: "approved"
  }, {
    id: "creator-fixture",
    slug: "creator-fixture",
    display_name: "Creator Fixture"
  }, [
    { id: "cover", purpose: "cover", validation_state: "accepted" },
    { id: "product", purpose: "product", validation_state: "accepted" }
  ], { nowMs: Date.UTC(2026, 8, 27) });
  assert.equal(mapped.valid, true);
  assert.equal(mapped.metadata.status, "available-direct");
  assert.equal(mapped.metadata.buyMode, "cart");
  assert.equal(mapped.metadata.productIdentityId, "listing-published-fixture");

  console.log("Legacy catalog publication consistency tests passed.");
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
