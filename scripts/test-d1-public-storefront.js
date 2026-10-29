const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const storefront = await import(pathToFileURL(path.join(ROOT, "functions/_lib/public-storefront.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  const db = d1(raw);
  const created = await catalog.createProduct(db, {
    id: "storefront-native-item",
    slug: "storefront-native-item",
    creatorId: "creator-rv-sawyer",
    publicationState: "published",
    title: "Native Catalog Road Test",
    subtitle: "No rebuild required",
    shortDescription: "A live D1 storefront product.",
    longDescription: "First paragraph.\n\nSecond paragraph.",
    publisher: "Tobacco Road Games",
    gameSystem: "System Neutral",
    productLine: "Road Tests",
    genre: "tabletop-rpg",
    mediaType: "digital",
    status: "pay-what-you-want",
    buyMode: "cart",
    currency: "USD",
    pricingModel: "pwyw",
    priceCents: 700,
    minimumPriceCents: 200,
    suggestedPriceCents: 700,
    coverR2Key: "catalog-publications/storefront-native-item/cover.webp",
    previewR2Key: "catalog-publications/storefront-native-item/preview.webp",
    deliveryR2Key: "catalog-publications/storefront-native-item/delivery.pdf",
    deliveryFilename: "road-test.pdf",
    deliveryContentType: "application/pdf",
    metadata: { authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"], format: ["PDF"],
      features: ["Cloudflare native"], version: "1.0", pageCount: 12,
      releaseDate: "2026-10-29", series: "Reconstruction" }
  });

  const response = await storefront.handlePublicProductPage(context(db, created.slug));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /Native Catalog Road Test/);
  assert.match(html, /RV Sawyer/);
  assert.match(html, /Pay What You Want — \$2\.00 minimum; \$7\.00 suggested/);
  assert.match(html, /\/product-assets\/storefront-native-item\/cover\.webp/);
  assert.match(html, /Purchase temporarily unavailable/);
  assert.doesNotMatch(html, /data-cart-add/);
  assert.doesNotMatch(html, /delivery\.pdf|road-test\.pdf|catalog-publications/);

  await catalog.updateProduct(db, created.id, { subtitle: "Updated without deployment", suggestedPriceCents: 900 }, {
    expectedRevision: created.revision
  });
  const updatedHtml = await (await storefront.handlePublicProductPage(context(db, created.slug))).text();
  assert.match(updatedHtml, /Updated without deployment/);
  assert.match(updatedHtml, /\$9\.00 suggested/);

  await catalog.createProduct(db, {
    id: "draft-storefront-item", slug: "draft-storefront-item", creatorId: "creator-rv-sawyer",
    publicationState: "draft", title: "Hidden Draft", status: "coming-soon", buyMode: "coming-soon",
    pricingModel: "fixed", priceCents: 100
  });
  let fellThrough = false;
  const draftResponse = await storefront.handlePublicProductPage({
    ...context(db, "draft-storefront-item"), next: async () => { fellThrough = true; return new Response("legacy miss", { status: 404 }); }
  });
  assert.equal(draftResponse.status, 404);
  assert.equal(fellThrough, true, "Unpublished D1 records must not render as public product pages.");

  const unknown = await storefront.handlePublicProductPage(context(db, "not-a-product"));
  assert.equal(unknown.status, 404);

  const client = fs.readFileSync(path.join(ROOT, "assets/js/d1-storefront.js"), "utf8");
  const runtime = fs.readFileSync(path.join(ROOT, "assets/js/storefront.js"), "utf8");
  const store = fs.readFileSync(path.join(ROOT, "store/index.html"), "utf8");
  const catalogPage = fs.readFileSync(path.join(ROOT, "store/catalog/index.html"), "utf8");
  assert.match(client, /\/api\/catalog\?limit=/);
  assert.match(client, /querySelectorAll\(selector\).*remove/s, "Published D1 products must replace legacy cards with the same slug.");
  assert.match(client, /storefrontVisibility === "listed"/);
  assert.doesNotMatch(client, /data-cart-add/);
  assert.match(runtime, /TRGD1Storefront\?\.hydrate/);
  assert.match(store, /d1-storefront\.js/);
  assert.match(catalogPage, /d1-storefront\.js/);
  raw.close();
  console.log("D1 public storefront tests passed.");
}

function context(database, slug) {
  return {
    request: new Request(`https://staging.example/store/products/${slug}/`),
    env: { TRG_ORDERS: database }, params: { slug },
    next: async () => new Response("not found", { status: 404 })
  };
}

function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values).changes) } }; }
      };
    }
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
