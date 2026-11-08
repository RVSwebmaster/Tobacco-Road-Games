const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-10-29T12:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();

async function main() {
  const catalog = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-catalog-d1.mjs")).href);
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(fs.readFileSync(path.join(ROOT, "migrations", file), "utf8"));
  }
  const db = d1(raw);
  const creatorId = "creator-rv-sawyer";
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','admin',?,?)")
    .run("catalog-admin-manager", "catalog-admin-manager@example.invalid", NOW, NOW);
  raw.prepare("INSERT INTO creator_listings(id,creator_id,slug,title,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("listing-tablecraft", creatorId, "tablecraft", "Tablecraft", NOW, NOW);

  seedHistoricalPurchase(raw);
  const input = {
    id: "listing-tablecraft", // Existing product identity may be retained during migration.
    slug: "tablecraft",
    creatorId,
    managedByUserId: "catalog-admin-manager",
    creatorListingId: "listing-tablecraft",
    publicationState: "draft",
    title: "Tablecraft",
    subtitle: "A complete tabletop guide",
    shortDescription: "Practical advice for play.",
    longDescription: "Detailed techniques for the table.",
    publisher: "Tobacco Road Games",
    gameSystem: "System Neutral",
    productLine: "Tablecraft",
    genre: "reference",
    mediaType: "digital",
    status: "available-direct",
    buyMode: "cart",
    currency: "USD",
    pricingModel: "fixed",
    priceCents: 1200,
    coverR2Key: "tablecraft/cover.webp",
    previewR2Key: "tablecraft/preview.webp",
    thumbnailR2Key: "tablecraft/thumbnail.webp",
    deliveryR2Key: "tablecraft/product.pdf",
    deliveryFilename: "Tablecraft.pdf",
    deliveryContentType: "application/pdf",
    metadata: {
      authors: ["RV Sawyer"], authorSlugs: ["rv-sawyer"],
      format: ["PDF"], tags: ["Advice"], features: ["Exercises"],
      version: "1.0", openRulesEligible: true
    }
  };
  const created = await catalog.createProduct(db, input, { nowMs: NOW_MS });
  assert.equal(created.id, input.id);
  assert.equal(created.slug, input.slug);
  assert.equal(created.creatorListingId, input.creatorListingId);
  assert.equal(created.managedByUserId, "catalog-admin-manager");
  assert.equal(created.coverR2Key, input.coverR2Key);
  assert.equal(created.deliveryR2Key, input.deliveryR2Key);
  assert.deepEqual(created.metadata, input.metadata);
  assert.equal(created.revision, 1);
  assert.equal(created.createdAt, NOW);
  assert.deepEqual(await catalog.getProductById(db, created.id), created);
  assert.deepEqual(await catalog.getProductBySlug(db, created.slug), created);
  assert.equal(await catalog.getProductBySlug(db, "missing"), null);

  const pwyw = await catalog.createProduct(db, {
    slug: "pay-what-you-want-guide", creatorId, title: "PWYW Guide",
    status: "pay-what-you-want", buyMode: "cart", pricingModel: "pwyw",
    priceCents: 500, suggestedPriceCents: 500, minimumPriceCents: 0,
    metadata: { contentDescriptors: ["None"] }
  }, { nowMs: NOW_MS });
  assert.equal(pwyw.minimumPriceCents, 0);
  assert.equal(pwyw.publicationState, "draft");
  assert.deepEqual((await catalog.listProducts(db)).map(item => item.slug), ["agency", "pay-what-you-want-guide", "tablecraft"]);
  assert.deepEqual((await catalog.listProducts(db, { creatorId, publicationState: "draft", status: "available-direct" })).map(item => item.slug), ["tablecraft"]);
  assert.deepEqual((await catalog.listProducts(db, { limit: 1, offset: 1 })).map(item => item.slug), ["pay-what-you-want-guide"]);

  const updated = await catalog.updateProduct(db, created.id, {
    title: "Tablecraft Revised", priceCents: 1500,
    saleEnabled: true, salePriceCents: 1200,
    saleStart: "2026-11-01", saleEnd: "2026-11-30",
    deliveryR2Key: "tablecraft/revised.pdf",
    metadata: { ...created.metadata, version: "2.0" }
  }, { expectedRevision: 1, nowMs: NOW_MS + 1000 });
  assert.equal(updated.revision, 2);
  assert.equal(updated.slug, "tablecraft");
  assert.equal(updated.priceCents, 1500);
  assert.equal(updated.saleEnabled, true);
  assert.equal(updated.metadata.version, "2.0");
  assert.equal(updated.deliveryR2Key, "tablecraft/revised.pdf");
  assert.equal(updated.managedByUserId, "catalog-admin-manager");
  assert.equal(updated.createdAt, NOW);
  assert.equal(updated.updatedAt, new Date(NOW_MS + 1000).toISOString());
  assert.equal((await catalog.getProductBySlug(db, "tablecraft")).id, created.id);
  assert.equal(raw.prepare("SELECT product_slug,product_title_snapshot,list_price_cents FROM order_items").get().product_title_snapshot, "Tablecraft historical");
  assert.deepEqual({ ...raw.prepare("SELECT product_slug,r2_object_key,customer_filename FROM download_entitlements").get() }, {
    product_slug: "tablecraft", r2_object_key: "tablecraft/original.pdf", customer_filename: "Original.pdf"
  });

  await assert.rejects(catalog.updateProduct(db, created.id, { title: "Stale" }, { expectedRevision: 1 }), error => error.code === "conflict");
  await assert.rejects(catalog.updateProduct(db, created.id, { slug: "renamed" }), error => error.code === "invalid_input");
  await assert.rejects(catalog.createProduct(db, input), /UNIQUE/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", creatorId: "missing", creatorListingId: null }), /FOREIGN KEY/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", creatorId: "missing" }), /same owner/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", pricingModel: "pwyw", suggestedPriceCents: 100, minimumPriceCents: 200 }), /PWYW/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", priceCents: 0 }), /positive price/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", status: "unreviewed" }), /status is invalid/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", metadata: { slug: "shadow" } }), /cannot shadow/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", coverR2Key: "../cover.webp" }), /safe R2 object key/);
  await assert.rejects(catalog.createProduct(db, { ...input, id: "bad", slug: "bad", deliveryFilename: null }), /delivery R2 key requires/i);
  await assert.rejects(catalog.updateProduct(db, created.id, { creatorListingId: null }), /cannot be changed/);
  await assert.rejects(catalog.listProducts(db, { limit: 500 }), /limit/);
  assert.throws(() => raw.prepare("UPDATE marketplace_products SET slug='renamed' WHERE id=?").run(created.id), /immutable/);
  assert.throws(() => raw.prepare("UPDATE marketplace_products SET creator_listing_id=NULL WHERE id=?").run(created.id), /immutable/);
  assert.throws(() => raw.prepare("UPDATE marketplace_products SET price_cents=-1 WHERE id=?").run(created.id), /CHECK constraint/);
  assert.throws(() => raw.prepare("DELETE FROM marketplace_products WHERE id=?").run(created.id), /retire products/);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products").get().n, 3);
  await assert.rejects(catalog.deleteDraftProduct(db, created.id), /retire products/);
  assert.equal(await catalog.deleteDraftProduct(db, pwyw.id), true);
  assert.equal(await catalog.getProductById(db, pwyw.id), null);
  assert.equal(await catalog.deleteDraftProduct(db, pwyw.id), false);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products").get().n, 2);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  raw.close();
  console.log("D1 product catalog tests passed.");
}

function seedHistoricalPurchase(raw) {
  raw.prepare(`INSERT INTO orders(public_id,customer_email,customer_email_normalized,customer_email_hash,
    currency,subtotal_cents,total_cents,payment_status,fulfillment_status,email_status,created_at)
    VALUES('historical-order','buyer@example.invalid','buyer@example.invalid','hash','USD',1000,1000,'paid','fulfilled','sent',?)`).run(NOW);
  const orderId = raw.prepare("SELECT id FROM orders WHERE public_id='historical-order'").get().id;
  raw.prepare(`INSERT INTO order_items(order_id,product_slug,product_title_snapshot,primary_author_slug,
    author_slugs_json,quantity,list_price_cents,effective_unit_price_cents,line_total_cents,
    currency,version_snapshot,last_updated_snapshot,created_at)
    VALUES(?,'tablecraft','Tablecraft historical','rv-sawyer','["rv-sawyer"]',1,1000,1000,1000,'USD','1.0',?,?)`)
    .run(orderId, NOW, NOW);
  const itemId = raw.prepare("SELECT id FROM order_items WHERE order_id=?").get(orderId).id;
  raw.prepare(`INSERT INTO download_entitlements(order_id,order_item_id,product_slug,r2_object_key,
    customer_filename,content_type,object_size_bytes,created_at)
    VALUES(?,?,'tablecraft','tablecraft/original.pdf','Original.pdf','application/pdf',10,?)`)
    .run(orderId, itemId, NOW);
}

function d1(raw) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return raw.prepare(sql).get(...values) || null; },
        async all() { return { results: raw.prepare(sql).all(...values) }; },
        async run() { const result = raw.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
      };
    }
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
