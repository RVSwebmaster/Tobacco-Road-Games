const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const COVER = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

async function main() {
  const assets = await import(pathToFileURL(path.join(ROOT, "functions/_lib/public-product-assets.mjs")).href);
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8"));
  }
  const database = d1(raw);
  const base = { creatorId: "creator-rv-sawyer", status: "available-direct", buyMode: "cart",
    pricingModel: "fixed", priceCents: 500 };
  await catalog.createProduct(database, { ...base, id: "public-cover", slug: "public-cover",
    title: "Public cover", publicationState: "published", coverR2Key: "catalog/public-cover.webp",
    backCoverR2Key: "catalog/public-back.webp",
    previewR2Key: "catalog/missing-preview.webp", deliveryR2Key: "catalog/private.pdf",
    deliveryFilename: "private.pdf", deliveryContentType: "application/pdf" });
  await catalog.createProduct(database, { ...base, id: "draft-cover", slug: "draft-cover",
    title: "Draft cover", publicationState: "draft", coverR2Key: "catalog/draft.webp" });
  await catalog.createProduct(database, { ...base, id: "private-alias", slug: "private-alias",
    title: "Private alias", publicationState: "published", coverR2Key: "catalog/private.pdf",
    deliveryR2Key: "catalog/private.pdf", deliveryFilename: "private.pdf",
    deliveryContentType: "application/pdf" });
  await catalog.createProduct(database, { ...base, id: "wrong-type", slug: "wrong-type",
    title: "Wrong type", publicationState: "published", coverR2Key: "catalog/wrong-type.webp" });

  const bucket = r2(new Map([
    ["catalog/public-cover.webp", object(COVER, "image/webp")],
    ["catalog/public-back.webp", object(COVER, "image/webp")],
    ["catalog/private.pdf", object(Uint8Array.from([37, 80, 68, 70]), "application/pdf")],
    ["catalog/draft.webp", object(COVER, "image/webp")],
    ["catalog/wrong-type.webp", object(Uint8Array.from([37, 80, 68, 70]), "application/pdf")]
  ]));
  const request = (slug, asset, options) => assets.handlePublicProductAssetRequest({
    params: { slug, asset }, env: { TRG_ORDERS: database, TRG_PRODUCTS: bucket }
  }, options);

  const cover = await request("public-cover", "cover.webp");
  assert.equal(cover.status, 200);
  assert.deepEqual(new Uint8Array(await cover.arrayBuffer()), COVER);
  assert.equal(cover.headers.get("content-type"), "image/webp");
  assert.equal(cover.headers.get("etag"), '"fixture-etag"');
  assert.match(cover.headers.get("cache-control"), /^public,/);
  assert.equal(cover.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(bucket.getKeys, ["catalog/public-cover.webp"]);
  const back = await request("public-cover", "back-cover.webp");
  assert.equal(back.status, 200);
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), COVER);

  const head = await request("public-cover", "cover.webp", { headOnly: true });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.deepEqual(bucket.headKeys, ["catalog/public-cover.webp"]);

  assert.equal((await request("missing", "cover.webp")).status, 404);
  assert.equal((await request("draft-cover", "cover.webp")).status, 404);
  assert.equal((await request("public-cover", "preview.webp")).status, 404);
  assert.equal((await request("public-cover", "delivery.pdf")).status, 404);
  assert.equal((await request("public-cover", "../private.pdf")).status, 404);
  assert.equal((await request("private-alias", "cover.webp")).status, 404);
  assert.equal((await request("wrong-type", "cover.webp")).status, 404);
  assert.equal(bucket.getKeys.includes("catalog/private.pdf"), false);
  assert.equal((await assets.handlePublicProductAssetRequest({ params: { slug: "public-cover", asset: "cover.webp" },
    env: { TRG_PRODUCTS: bucket } })).status, 503);
  assert.equal((await assets.handlePublicProductAssetRequest({ params: { slug: "public-cover", asset: "cover.webp" },
    env: { TRG_ORDERS: database } })).status, 503);

  const routeSource = fs.readFileSync(path.join(ROOT, "functions/product-assets/[slug]/[asset].js"), "utf8");
  assert.doesNotMatch(routeSource, /product-folder-map|getFolderForSlug/);
  assert.match(routeSource, /public-product-assets/);
  raw.close();
  console.log("D1-backed public product asset tests passed.");
}

function object(bytes, contentType) {
  return {
    body: Uint8Array.from(bytes),
    size: bytes.byteLength,
    httpEtag: '"fixture-etag"',
    httpMetadata: { contentType },
    writeHttpMetadata(headers) { headers.set("content-type", contentType); }
  };
}

function r2(objects) {
  return {
    getKeys: [], headKeys: [],
    async get(key) { this.getKeys.push(key); return objects.get(key) || null; },
    async head(key) { this.headKeys.push(key); return objects.get(key) || null; }
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
