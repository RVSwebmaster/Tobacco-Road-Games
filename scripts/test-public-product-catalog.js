const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const route = await import(pathToFileURL(path.join(ROOT, "functions/_lib/public-product-catalog.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(n => n.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  const db = d1(raw);
  const base = { creatorId: "creator-rv-sawyer", status: "pay-what-you-want", buyMode: "cart",
    pricingModel: "pwyw", priceCents: 500, suggestedPriceCents: 500, minimumPriceCents: 0 };
  await catalog.createProduct(db, { ...base, id: "public-item", slug: "public-item", title: "Public Item",
    publicationState: "published", listingVisibility: "listed", coverR2Key: "catalog-publications/one/cover.webp",
    backCoverR2Key: "catalog-publications/one/back-cover.webp",
    deliveryR2Key: "catalog-publications/one/delivery.pdf", deliveryFilename: "secret.pdf",
    deliveryContentType: "application/pdf", metadata: { authors: ["RV Sawyer"],
      tags: ["Game"], privateNote: "do not expose" } });
  await catalog.createProduct(db, { ...base, id: "draft-item", slug: "draft-item", title: "Draft Item",
    publicationState: "draft", metadata: { privateNote: "hidden" } });
  await catalog.createProduct(db, { ...base, id: "preview-open-rules", slug: "preview-open-rules", title: "Preview Open Rules",
    publicationState: "published", status: "preview-only", buyMode: "preview-only", priceCents: 0,
    listingVisibility: "listed",
    coverR2Key: "catalog-publications/preview-open-rules/cover.webp",
    metadata: { openRulesEligible: true, pageCount: 122 } });
  await catalog.createProduct(db, { ...base, id: "z-private-item", slug: "z-private-item", title: "Private Item",
    publicationState: "published", listingVisibility: "unlisted", metadata: {} });
  const get = url => route.handlePublicCatalogRequest(new Request(url), { TRG_ORDERS: db });

  const lookup = await get("https://example.test/api/catalog?slug=public-item");
  assert.equal(lookup.status, 200);
  const publicItem = (await lookup.json()).product;
  assert.equal(publicItem.id, "public-item");
  assert.equal(publicItem.creatorName, "RV Sawyer");
  assert.equal(publicItem.creatorSlug, "rv-sawyer");
  assert.equal(publicItem.hasCover, true);
  assert.equal(publicItem.coverUrl, "/product-assets/public-item/cover.webp");
  assert.equal(publicItem.backCoverUrl, "/product-assets/public-item/back-cover.webp");
  assert.equal(publicItem.backCoverR2Key, undefined);
  assert.equal(publicItem.detailUrl, "/store/products/public-item/");
  assert.equal(publicItem.storefrontVisibility, "listed");
  assert.equal(publicItem.purchaseAvailability, "cart-quote-only");
  assert.deepEqual(publicItem.metadata.authors, ["RV Sawyer"]);
  assert.equal(publicItem.metadata.privateNote, undefined);
  assert.equal(publicItem.coverR2Key, undefined);
  assert.equal(publicItem.deliveryR2Key, undefined);
  assert.equal(publicItem.deliveryFilename, undefined);
  assert.equal((await get("https://example.test/api/catalog?slug=draft-item")).status, 404);
  const previewOpenRules = (await (await get("https://example.test/api/catalog?slug=preview-open-rules")).json()).product;
  assert.equal(previewOpenRules.storefrontVisibility, "listed");
  assert.equal(previewOpenRules.purchaseAvailability, "unavailable");
  assert.equal(previewOpenRules.metadata.openRulesEligible, true);
  const privateItem = (await (await get("https://example.test/api/catalog?slug=z-private-item")).json()).product;
  assert.equal(privateItem.storefrontVisibility, "unlisted");
  assert.equal(privateItem.purchaseAvailability, "unavailable");
  const related = await route.getOtherApprovedPublicProductsByCreator(db, "creator-rv-sawyer", "public-item");
  assert.ok(related.some(item => item.detailUrl === "/store/products/preview-open-rules/"));
  assert.ok(!related.some(item => item.detailUrl === "/store/products/z-private-item/"));

  const listing = await get("https://example.test/api/catalog?creatorId=creator-rv-sawyer&status=pay-what-you-want&limit=1&offset=0");
  assert.equal(listing.status, 200);
  const listingBody = await listing.json();
  assert.deepEqual(listingBody.products.map(item => item.slug), ["public-item"]);
  assert.equal(listingBody.scannedCount, 1);
  assert.deepEqual((await (await get("https://example.test/api/catalog?status=available-direct")).json()).products, []);
  assert.equal((await get("https://example.test/api/catalog?limit=0")).status, 400);
  assert.equal((await get("https://example.test/api/catalog?slug=bad%2Fslug")).status, 400);
  assert.equal((await route.handlePublicCatalogRequest(new Request("https://example.test/api/catalog", { method: "POST" }),
    { TRG_ORDERS: db })).status, 405);
  assert.equal((await route.handlePublicCatalogRequest(new Request("https://example.test/api/catalog"), {})).status, 503);
  assert.match(fs.readFileSync(path.join(ROOT, "_routes.json"), "utf8"), /"\/api\/catalog"/);
  raw.close();
  console.log("Public D1 product catalog tests passed.");
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
