const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { NOW_MS, CREATOR_A, CREATOR_B, PDF_BYTES, COVER_BYTES, createCreator, creatorRequest, applyMigrations, createD1, load } = require("./test-creator-product-withdrawal.js");

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const creator = await load("functions/_lib/creator-operations.mjs");
  const files = await load("functions/_lib/creator-files.mjs");
  const catalog = await load("functions/_lib/public-product-catalog.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  applyMigrations(raw);
  await createCreator(raw, auth, CREATOR_A);
  await createCreator(raw, auth, CREATOR_B);
  const db = createD1(raw), bucket = memoryBucket(), env = { TRG_ORDERS: db, TRG_PRODUCTS: bucket }, options = { database: db, nowMs: NOW_MS };
  try {
    let response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, "listings", {
      slug: "direct-creator-publication", title: "Direct Creator Publication", shortDescription: "Disposable direct publication.", longDescription: "This listing is published by its validated Creator.", priceCents: 800, mediaType: "digital", format: ["PDF"], gameSystem: "System Neutral", genre: "test"
    }), env, options);
    assert.equal(response.status, 201);
    const listingId = (await response.json()).listing.id;
    const form = new FormData();
    form.set("purpose", "product");
    form.set("file", new File([PDF_BYTES], "direct.pdf", { type: "application/pdf" }));
    form.set("generatedFront", new File([COVER_BYTES], "front.webp", { type: "image/webp" }));
    form.set("generatedBack", new File([COVER_BYTES], "back.webp", { type: "image/webp" }));
    form.set("pdfPageCount", "4");
    response = await files.handleCreatorFileUpload(fileRequest(CREATOR_A, listingId, form), env, listingId, options);
    assert.equal(response.status, 201);
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_B, `listings/${listingId}/publish`, { expectedRevision: 1, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }), env, options);
    assert.equal(response.status, 404);
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}/publish`, { expectedRevision: 1, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }), env, options);
    assert.equal(response.status, 200, await response.text());
    const first = raw.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").get(listingId);
    assert.equal(first.publication_state, "published");
    assert.equal(first.storefront_visibility, "unlisted");
    const identity = { id: first.id, slug: first.slug, creator_id: first.creator_id };
    let listing = raw.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}/shelve`, { expectedRevision: listing.revision, expectedProductRevision: first.revision }), env, options);
    assert.equal(response.status, 200, await response.text());
    listing = raw.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
    let shelved = raw.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").get(listingId);
    assert.equal(shelved.storefront_visibility, "listed");
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}/unshelve`, { expectedRevision: listing.revision, expectedProductRevision: shelved.revision }), env, options);
    assert.equal(response.status, 200, await response.text());
    listing = raw.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
    shelved = raw.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").get(listingId);
    assert.equal(shelved.storefront_visibility, "unlisted");
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}`, { expectedRevision: listing.revision, title: "Direct Creator Publication Revised", shortDescription: "Revised direct publication.", longDescription: "The same native product identity was retained.", priceCents: 900, mediaType: "digital", format: ["PDF"], gameSystem: "System Neutral", genre: "test" }), env, options);
    assert.equal(response.status, 200, await response.text());
    listing = raw.prepare("SELECT * FROM creator_listings WHERE id=?").get(listingId);
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}/publish`, { expectedRevision: listing.revision, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }), env, options);
    assert.equal(response.status, 200, await response.text());
    const revised = raw.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").get(listingId);
    assert.equal(revised.id, identity.id);
    assert.equal(revised.slug, identity.slug);
    assert.equal(revised.creator_id, identity.creator_id);
    assert.equal(revised.price_cents, 900);
    response = await catalog.handlePublicCatalogRequest(new Request("https://example.com/api/catalog?limit=100"), env);
    assert.equal(response.status, 200);
    assert.ok(!(await response.json()).products.some(product => product.slug === "direct-creator-publication"), "Unshelved publication is absent from public catalog browsing.");
    console.log("Direct Creator publication, ownership, shelving, unshelving, revision, and catalog visibility test passed.");
  } finally { raw.close(); }
}
function fileRequest(identity, listingId, form) { return new Request(`https://example.com/api/creator/listings/${listingId}/files`, { method: "POST", headers: { origin: "https://example.com", cookie: `__Host-trg_session=${identity.session}; trg_account_csrf=${identity.csrf}`, "x-csrf-token": identity.csrf }, body: form }); }
function memoryBucket() { const objects = new Map(); const read = key => { const row = objects.get(key); return row && { body: row.bytes, size: row.bytes.length, objectSize: row.bytes.length, httpMetadata: row.httpMetadata, customMetadata: row.customMetadata }; }; return { async put(key, bytes, options = {}) { objects.set(key, { bytes: Buffer.from(bytes), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata }); }, async get(key) { return read(key) || null; }, async head(key) { return read(key) || null; }, async delete(key) { objects.delete(key); } }; }
main().catch(error => { console.error(error); process.exitCode = 1; });
