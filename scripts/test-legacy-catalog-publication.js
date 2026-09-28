const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const AFFECTED = ["agency", "circle-of-cinder", "janni", "ringbound", "tablecraft-primer"];
const SALEABLE_STATUSES = new Set(["available-direct", "free-download", "pay-what-you-want"]);
const SALEABLE_BUY_MODES = new Set(["cart", "fixed-price", "free-download", "manual-invoice", "pay-what-you-want"]);

async function main() {
  const products = JSON.parse(read("data/products.json"));
  const productMap = new Map(products.map((product) => [product.slug, product]));
  const migration = read("migrations/018_creator_operations.sql");
  const seededSlugs = [...migration.matchAll(/'listing-[^']+','creator-rv-sawyer','([^']+)','([^']+)'/g)]
    .map((match) => match[2]);

  assert.equal(seededSlugs.length, 12, "The compatibility inventory should include every migration-seeded listing.");
  for (const slug of seededSlugs) {
    const product = productMap.get(slug);
    assert.ok(product, `${slug} should retain its historical static record.`);
    if (!product.productIdentityId) {
      assert.equal(SALEABLE_STATUSES.has(product.status), false, `${slug} must not use a saleable status before current publication.`);
      assert.equal(SALEABLE_BUY_MODES.has(product.buyMode), false, `${slug} must not use a saleable buy mode before current publication.`);
    }
  }

  for (const slug of AFFECTED) {
    const product = productMap.get(slug);
    assert.equal(product.status, "legacy-not-for-sale");
    assert.equal(product.buyMode, "retired");
    assert.equal(product.saleEnabled, false);

    const directPage = read(`store/products/${slug}/index.html`);
    assert.match(directPage, /Legacy Not For Sale/);
    assert.match(directPage, /historical catalog record and is not currently available for purchase/);
    assert.doesNotMatch(directPage, new RegExp(`data-cart-add=["']${slug}["']`));
    assert.doesNotMatch(directPage, new RegExp(`/product-assets/${slug}/`));

    for (const activePage of ["store/index.html", "store/catalog/index.html", "store/cart/index.html", "store/sitemap.xml"]) {
      assert.doesNotMatch(read(activePage), new RegExp(`/store/products/${slug}/`), `${slug} must stay out of ${activePage}.`);
    }
  }

  const homepage = JSON.parse(read("data/homepage.json"));
  assert.equal(AFFECTED.includes(homepage.featuredSlug), false);
  assert.deepEqual(homepage.workInProgressSlugs.filter((slug) => AFFECTED.includes(slug)), []);

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
