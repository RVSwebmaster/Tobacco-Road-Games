const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  NOW_MS, CREATOR_A, CREATOR_B, PDF_BYTES, COVER_BYTES,
  createCreator, creatorRequest, commerceSnapshot, applyMigrations,
  createD1, sha256, load
} = require("./test-creator-product-withdrawal.js");

const OWNER = { id: "owner-native-e2e", token: "owner-native-e2e-token", csrf: "owner-native-e2e-csrf" };
const SLUG = "creator-native-end-to-end";

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const creator = await load("functions/_lib/creator-operations.mjs");
  const files = await load("functions/_lib/creator-files.mjs");
  const fileReview = await load("functions/_lib/creator-publication.mjs");
  const review = await load("functions/_lib/creator-review.mjs");
  const catalog = await load("functions/_lib/public-product-catalog.mjs");
  const assets = await load("functions/_lib/public-product-assets.mjs");
  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(raw);
    raw.prepare("UPDATE runtime_settings SET setting_value='CLOSED' WHERE setting_key='store_state'").run();
    await createCreator(raw, auth, CREATOR_A);
    await createCreator(raw, auth, CREATOR_B);
    const now = new Date(NOW_MS).toISOString();
    raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','owner',?,?)")
      .run(OWNER.id, "owner-native-e2e@example.invalid", now, now);
    raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
      .run(`${OWNER.id}-session`, OWNER.id, await auth.hashToken(OWNER.token), await auth.hashToken(OWNER.csrf), now, "2027-11-02T00:00:00.000Z", now);
    const db = createD1(raw), bucket = memoryBucket(), env = { TRG_ORDERS: db, TRG_PRODUCTS: bucket };
    const options = { database: db, nowMs: NOW_MS };
    const commerceBefore = commerceSnapshot(raw);

    let response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, "listings", {
      slug: SLUG, title: "Native end-to-end test product", shortDescription: "Disposable native publication fixture.",
      longDescription: "This product exists only in an in-memory integration test.",
      priceCents: 800, mediaType: "digital", format: ["PDF"], gameSystem: "System Neutral", genre: "test"
    }), env, options);
    await status(response, 201, "create draft");
    const listingId = (await response.json()).listing.id;

    const generated = new FormData();
    generated.set("purpose", "product");
    generated.set("file", new File([PDF_BYTES], "native-test.pdf", { type: "application/pdf" }));
    generated.set("generatedFront", new File([COVER_BYTES], "front.webp", { type: "image/webp" }));
    generated.set("generatedBack", new File([COVER_BYTES], "back.webp", { type: "image/webp" }));
    generated.set("pdfPageCount", "122");
    response = await files.handleCreatorFileUpload(fileRequest(CREATOR_A, listingId, generated), env, listingId, options);
    await status(response, 201, "upload PDF with generated cover pages");
    const fileId = (await response.json()).file.id;
    const uploaded = raw.prepare("SELECT * FROM creator_listing_files WHERE id=?").get(fileId);
    assert.equal(uploaded.pdf_page_count, 122);
    assert.deepEqual(bucket.bytes(uploaded.quarantine_key), PDF_BYTES);
    assert.deepEqual(bucket.bytes(uploaded.generated_cover_key), COVER_BYTES);
    assert.deepEqual(bucket.bytes(uploaded.generated_back_cover_key), COVER_BYTES);

    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_B, `listings/${listingId}/submit`, {
      rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true
    }), env, options);
    assert.ok([403, 404].includes(response.status), "Another Creator cannot submit this listing.");
    response = await creator.handleCreatorRequest(creatorRequest(CREATOR_A, `listings/${listingId}/submit`, {
      rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true
    }), env, options);
    await status(response, 200, "submit listing");
    assert.equal(raw.prepare("SELECT lifecycle_state FROM creator_listings WHERE id=?").get(listingId).lifecycle_state, "submitted");

    response = await review.handleCreatorReviewRequest(ownerPost("creator-reviews", { listingId, expectedRevision: 2, action: "approve" }), env, options);
    assert.equal(response.status, 409, "Owner approval requires accepted files.");
    response = await fileReview.handleCreatorPublicationRequest(ownerPost("creator-publication", {
      action: "accept_file", fileId, expectedRevision: 2
    }), env, options);
    await status(response, 200, "accept PDF and generated artwork");
    response = await review.handleCreatorReviewRequest(ownerPost("creator-reviews", {
      listingId, expectedRevision: 3, action: "approve"
    }), env, options);
    await status(response, 200, "approve and publish");
    const published = raw.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").get(listingId);
    assert.equal(published.publication_state, "published");
    assert.equal(published.creator_id, CREATOR_A.id);
    assert.equal(published.price_cents, 800);
    assert.equal(published.cover_r2_key, uploaded.generated_cover_key);
    assert.equal(published.back_cover_r2_key, uploaded.generated_back_cover_key);
    assert.equal(published.delivery_r2_key, uploaded.quarantine_key);
    assert.equal(sha256(bucket.bytes(published.delivery_r2_key)), sha256(PDF_BYTES));

    response = await catalog.handlePublicCatalogRequest(new Request(`https://example.com/api/catalog?slug=${SLUG}`), env);
    await status(response, 200, "public catalog");
    const publicProduct = (await response.json()).product;
    assert.equal(publicProduct.title, "Native end-to-end test product");
    assert.equal(publicProduct.priceCents, 800);
    assert.equal(publicProduct.backCoverUrl, `/product-assets/${SLUG}/back-cover.webp`);
    for (const asset of ["cover.webp", "back-cover.webp"]) {
      response = await assets.handlePublicProductAssetRequest({ params: { slug: SLUG, asset }, env });
      await status(response, 200, `public ${asset}`);
      assert.equal(response.headers.get("content-type"), "image/webp");
    }
    response = await assets.handlePublicProductAssetRequest({ params: { slug: SLUG, asset: "delivery.pdf" }, env });
    assert.equal(response.status, 404, "Private delivery is never a public asset.");
    assert.deepEqual(commerceSnapshot(raw), commerceBefore, "Publishing creates no customer purchases or entitlements.");
    assert.equal(raw.prepare("SELECT setting_value FROM runtime_settings WHERE setting_key='store_state'").get().setting_value, "CLOSED");
    console.log("Creator native end-to-end publishing test passed.");
  } finally { raw.close(); }
}

function fileRequest(identity, listingId, form) {
  return new Request(`https://example.com/api/creator/listings/${listingId}/files`, {
    method: "POST", headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${identity.session}; trg_account_csrf=${identity.csrf}`,
      "x-csrf-token": identity.csrf
    }, body: form
  });
}

function ownerPost(route, body) {
  return new Request(`https://example.com/owner/api/${route}`, {
    method: "POST", headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${OWNER.token}; trg_account_csrf=${OWNER.csrf}`,
      "x-csrf-token": OWNER.csrf, "content-type": "application/json"
    }, body: JSON.stringify(body)
  });
}

function memoryBucket() {
  const objects = new Map();
  const read = key => {
    const row = objects.get(key);
    return row && { body: row.bytes, size: row.bytes.length, objectSize: row.bytes.length,
      httpMetadata: row.httpMetadata, customMetadata: row.customMetadata };
  };
  return {
    async put(key, bytes, options = {}) {
      objects.set(key, { bytes: Buffer.from(bytes), httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata });
    },
    async get(key) { return read(key) || null; },
    async head(key) { return read(key) || null; },
    async delete(key) { objects.delete(key); },
    bytes(key) { return objects.get(key)?.bytes; }
  };
}

async function status(response, expected, step) {
  if (response.status !== expected) {
    assert.fail(`${step}: expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
