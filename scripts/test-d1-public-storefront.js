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
  assert.ok(html.indexOf('class="product-identity__creator') < html.indexOf('class="product-identity__product'), "Creator panel must precede Product panel.");
  assert.match(html, /RV Sawyer is the founder of Tobacco Road Games/);
  assert.match(html, /Creator image not available/);
  assert.ok(fs.existsSync(path.join(ROOT, "authors/rv-sawyer/index.html")), "The linked RV Sawyer profile must exist.");
  assert.match(html, /href="\/authors\/rv-sawyer\/">View creator profile/);
  assert.match(html, /No other products listed yet/);
  assert.match(html, /By RV Sawyer/);
  assert.match(html, /Publisher \/ Imprint: Tobacco Road Games/);
  assert.match(html, /Pay What You Want — \$2\.00 minimum; \$7\.00 suggested/);
  assert.match(html, /\/product-assets\/storefront-native-item\/cover\.webp/);
  assert.match(html, /class="product-hero__media" data-product-book data-page-count="12"/);
  assert.match(html, /<script src="\/assets\/js\/product-book\.js" defer><\/script>/);
  assert.match(html, /Open Preview/);
  assert.match(html, /Add to Cart/);
  assert.match(html, /data-cart-add="storefront-native-item"/);
  assert.match(html, /Payment and acquisition.*are not active yet/);
  assert.doesNotMatch(html, /delivery\.pdf|road-test\.pdf|catalog-publications/);

  await catalog.createProduct(db, {
    id: "storefront-cataloged-preview", slug: "storefront-cataloged-preview", creatorId: "creator-rv-sawyer",
    publicationState: "published", title: "Cataloged Preview", status: "preview-only",
    buyMode: "preview-only", pricingModel: "fixed", priceCents: 0
  });
  await catalog.createProduct(db, {
    id: "draft-storefront-item", slug: "draft-storefront-item", creatorId: "creator-rv-sawyer",
    publicationState: "draft", title: "Hidden Draft", status: "coming-soon", buyMode: "coming-soon",
    pricingModel: "fixed", priceCents: 100
  });
  await catalog.createProduct(db, {
    id: "storefront-same-creator", slug: "storefront-same-creator", creatorId: "creator-rv-sawyer",
    publicationState: "published", title: "Another Shelved Title", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500
  });
  const withCreatorCatalog = await (await storefront.handlePublicProductPage(context(db, created.slug))).text();
  assert.match(withCreatorCatalog, /href="\/store\/products\/storefront-same-creator\/">Another Shelved Title/);
  assert.doesNotMatch(withCreatorCatalog, /Cataloged Preview|Hidden Draft/);

  raw.prepare(`INSERT INTO marketplace_creators
    (id,slug,display_name,logo,short_bio,marketplace_status,registration_status,closure_state,created_at,updated_at)
    VALUES (?,?,?,?,?,'approved','active','active',?,?)`).run(
    "creator-second-studio", "second-studio", "Second Studio", "/assets/logo.png",
    "A separate seeded publishing identity.", "2026-11-07", "2026-11-07"
  );
  await catalog.createProduct(db, {
    id: "other-creator-product", slug: "other-creator-product", creatorId: "creator-second-studio",
    publicationState: "published", title: "Other Creator Title", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500,
    publisher: "Tobacco Road Games", metadata: { authors: ["RV Sawyer"] }
  });
  const otherCreatorHtml = await (await storefront.handlePublicProductPage(context(db, "other-creator-product"))).text();
  assert.match(otherCreatorHtml, /<h2 id="creator-identity-heading">Second Studio<\/h2>/);
  assert.match(otherCreatorHtml, /src="\/assets\/logo\.png" alt="Second Studio logo"/);
  assert.match(otherCreatorHtml, /A separate seeded publishing identity/);
  assert.match(otherCreatorHtml, /Public profile not available yet/);
  assert.doesNotMatch(otherCreatorHtml, /href="\/authors\/second-studio\/"/);
  assert.match(otherCreatorHtml, /By RV Sawyer/);
  assert.match(otherCreatorHtml, /Publisher \/ Imprint: Tobacco Road Games/);
  assert.doesNotMatch(otherCreatorHtml, /Another Shelved Title/);
  assert.doesNotMatch(withCreatorCatalog, /Other Creator Title/);
  raw.prepare("UPDATE marketplace_creators SET logo='',short_bio='' WHERE id='creator-second-studio'").run();
  const sparseCreatorHtml = await (await storefront.handlePublicProductPage(context(db, "other-creator-product"))).text();
  assert.match(sparseCreatorHtml, /Creator image not available/);
  assert.match(sparseCreatorHtml, /Biography not available yet/);

  const generated = require("./build-store.js");
  const staticPanel = generated.renderCreatorIdentityPanel({
    slug: "static-main", creatorSlug: "second-studio", publisher: "Tobacco Road Games",
    authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"]
  }, [
    { slug: "static-shelved", creatorSlug: "second-studio", status: "available-direct",
      publicationState: "published", title: "Static Shelved", url: "/store/products/static-shelved/" },
    { slug: "static-cataloged", creatorSlug: "second-studio", status: "preview-only",
      publicationState: "published", title: "Static Cataloged", url: "/store/products/static-cataloged/" },
    { slug: "static-other", creatorSlug: "rv-sawyer", status: "available-direct",
      publicationState: "published", title: "Other Identity", url: "/store/products/static-other/" }
  ], new Map([["second-studio", { name: "Second Studio", logo: "/assets/logo.png",
    shortBio: "A seeded profile.", url: "/authors/second-studio/" }]]));
  assert.match(staticPanel, /<h2 id="creator-identity-heading">Second Studio<\/h2>/);
  assert.match(staticPanel, /Static Shelved/);
  assert.doesNotMatch(staticPanel, /Static Cataloged|Other Identity/);
  assert.doesNotMatch(staticPanel, /<h2 id="creator-identity-heading">RV Sawyer<\/h2>/);

  await catalog.updateProduct(db, created.id, { subtitle: "Updated without deployment", suggestedPriceCents: 900 }, {
    expectedRevision: created.revision
  });
  const updatedHtml = await (await storefront.handlePublicProductPage(context(db, created.slug))).text();
  assert.match(updatedHtml, /Updated without deployment/);
  assert.match(updatedHtml, /\$9\.00 suggested/);

  let fellThrough = false;
  const draftResponse = await storefront.handlePublicProductPage({
    ...context(db, "draft-storefront-item"), next: async () => { fellThrough = true; return new Response("legacy miss", { status: 404 }); }
  });
  assert.equal(draftResponse.status, 404);
  assert.equal(fellThrough, true, "Unpublished D1 records must not render as public product pages.");
  assert.doesNotMatch(await (await storefront.handlePublicProductPage(context(db, created.slug))).text(), /Hidden Draft/);

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
