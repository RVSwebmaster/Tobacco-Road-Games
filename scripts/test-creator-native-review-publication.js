const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const NOW_MS = Date.parse("2026-11-02T16:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES = "2027-11-02T16:00:00.000Z";
const OWNER = { id: "owner-task2ob", token: "owner-task2ob-token", csrf: "owner-task2ob-csrf" };
const CREATOR = { id: "creator-task2ob", userId: "creator-user-task2ob", token: "creator-task2ob-token", csrf: "creator-task2ob-csrf" };

async function main() {
  const auth = await load("functions/_lib/account-auth.mjs");
  const review = await load("functions/_lib/creator-review.mjs");
  const publication = await load("functions/_lib/creator-publication.mjs");
  const creatorOperations = await load("functions/_lib/creator-operations.mjs");
  const creatorCover = await load("functions/_lib/creator-catalog-cover.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const publicCatalog = await load("functions/_lib/public-product-catalog.mjs");
  const publicAssets = await load("functions/_lib/public-product-assets.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  applyMigrations(raw);
  await seedIdentities(raw, auth);
  const db = d1(raw), bucket = r2();
  const env = { TRG_ORDERS: db, TRG_PRODUCTS: bucket };

  seedListing(raw, bucket, "listing-task2ob-publish", "creator-native-publish", "fixed", 1200, null, null);
  seedListing(raw, bucket, "listing-task2ob-reject", "creator-native-reject", "free", 0, null, null);
  seedListing(raw, bucket, "listing-task2ob-conflict", "creator-native-conflict", "pwyw", 700, 700, 0);
  seedListing(raw, bucket, "listing-task2ob-missing", "creator-native-missing", "fixed", 900, null, null);
  seedListing(raw, bucket, "listing-task2ob-withdraw", "creator-native-withdraw", "fixed", 800, null, null);
  bucket.deleteSync("creator-quarantine/creator-task2ob/listing-task2ob-missing/product.pdf");
  await catalog.createProduct(db, {
    id: "existing-task2ob-product", slug: "creator-native-conflict", creatorId: CREATOR.id,
    publicationState: "published", title: "Existing product", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500
  }, { nowMs: NOW_MS });

  let response = await review.handleCreatorReviewRequest(ownerGet(), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  let queue = await response.json();
  assert.equal(queue.listings.filter(row => row.creator_id === CREATOR.id).length, 5);
  assert.equal(queue.csrfToken, OWNER.csrf);

  response = await review.handleCreatorReviewRequest(creatorPost({ listingId: "listing-task2ob-publish", expectedRevision: 1, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 403, "A Creator cannot approve their own submission.");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: 1, action: "approve" }, "wrong"), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 403, "Owner mutations require CSRF verification.");

  let revision = 1;
  for (const purpose of ["cover", "product"]) {
    const file = raw.prepare("SELECT id FROM creator_listing_files WHERE listing_id=? AND purpose=?").get("listing-task2ob-publish", purpose);
    response = await publication.handleCreatorPublicationRequest(ownerPost({ action: "accept_file", fileId: file.id, expectedRevision: revision }), env, { database: db, nowMs: NOW_MS });
    assert.equal(response.status, 200); revision++;
  }
  const reviewedFile = raw.prepare("SELECT id FROM creator_listing_files WHERE listing_id=? AND purpose='cover'").get("listing-task2ob-publish");
  response = await publication.handleCreatorPublicationRequest(ownerPost({ action: "accept_file", fileId: reviewedFile.id, expectedRevision: revision }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Duplicate file decisions are safely rejected.");
  assert.equal(raw.prepare("SELECT revision FROM creator_listings WHERE id='listing-task2ob-publish'").get().revision, revision);
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: 2, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "A stale Owner decision must not overwrite file review.");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: revision, action: "approve", note: "Approved for native publication." }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  const approved = await response.json();
  assert.equal(approved.product.url, "/store/products/creator-native-publish/");
  const product = raw.prepare("SELECT * FROM marketplace_products WHERE id='listing-task2ob-publish'").get();
  assert.equal(product.publication_state, "published");
  assert.equal(product.creator_id, CREATOR.id);
  assert.equal(product.price_cents, 1200);
  assert.match(product.cover_r2_key, /cover\.webp$/);
  assert.match(product.delivery_r2_key, /product\.pdf$/);
  assert.equal(raw.prepare("SELECT publication_state FROM creator_listings WHERE id='listing-task2ob-publish'").get().publication_state, "published");
  response = await publicCatalog.handlePublicCatalogRequest(new Request("https://example.com/api/catalog?slug=creator-native-publish"), env);
  assert.equal(response.status, 200);
  const publicProduct = (await response.json()).product;
  assert.equal(publicProduct.creatorName, "Creator Task 2O-B");
  assert.equal(publicProduct.priceCents, 1200);
  assert.equal(JSON.stringify(publicProduct).includes("creator-quarantine/"), false, "Public catalog responses must not expose R2 keys.");
  response = await publicAssets.handlePublicProductAssetRequest({ params: { slug: "creator-native-publish", asset: "cover.webp" }, env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  response = await publicAssets.handlePublicProductAssetRequest({ params: { slug: "creator-native-publish", asset: "delivery.pdf" }, env });
  assert.equal(response.status, 404, "Private delivery assets are never available through the public asset route.");

  response = await creatorOperations.handleCreatorRequest(creatorApi("GET", "listings"), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  let creatorCatalog = await response.json();
  let managed = creatorCatalog.listings.find(row => row.id === "listing-task2ob-publish");
  assert.equal(managed.productId, "listing-task2ob-publish");
  assert.equal(managed.productRevision, 1);
  assert.equal(managed.revision, 5);
  assert.equal(managed.coverImage, "/api/creator/listings/listing-task2ob-publish/cover");
  response = await creatorCover.handleCreatorCatalogCover(creatorApi("GET", "listings/listing-task2ob-publish/cover"), env, "listing-task2ob-publish", { database: db });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  response = await creatorCover.handleCreatorCatalogCover(ownerGet(), env, "listing-task2ob-publish", { database: db });
  assert.equal(response.status, 404, "Another authenticated identity cannot retrieve a Creator's private cover.");

  response = await creatorOperations.handleCreatorRequest(creatorApi("POST", "listings/listing-task2ob-publish/pause", { expectedRevision: 5, expectedProductRevision: 1 }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200, "The owning Creator can pause a native D1 product.");
  assert.deepEqual({ ...raw.prepare("SELECT lifecycle_state,publication_state,revision FROM creator_listings WHERE id='listing-task2ob-publish'").get() }, { lifecycle_state: "paused", publication_state: "paused", revision: 6 });
  assert.deepEqual({ ...raw.prepare("SELECT publication_state,revision FROM marketplace_products WHERE id='listing-task2ob-publish'").get() }, { publication_state: "paused", revision: 2 });

  response = await creatorOperations.handleCreatorRequest(creatorApi("POST", "listings/listing-task2ob-publish", {
    expectedRevision: 6, title: "Revised Native Creator Product", shortDescription: "Revised short description.",
    longDescription: "Revised long description for an Owner-reviewed native product.", pricingModel: "pwyw",
    minimumPriceCents: 0, suggestedPriceCents: 1500, mediaType: "digital", format: ["PDF"], gameSystem: "System Neutral", genre: "fantasy"
  }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 7);
  assert.equal(raw.prepare("SELECT title FROM marketplace_products WHERE id='listing-task2ob-publish'").get().title, "Title creator-native-publish", "Creator edits remain private until Owner approval.");
  response = await creatorOperations.handleCreatorRequest(creatorApi("POST", "listings/listing-task2ob-publish", { expectedRevision: 6, title: "Stale overwrite" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Stale Creator edits cannot overwrite newer listing data.");

  response = await creatorOperations.handleCreatorRequest(creatorApi("POST", "listings/listing-task2ob-publish/submit", {
    expectedRevision: 7, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true
  }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: 8, action: "approve", note: "Approved revised catalog entry." }), env, { database: db, nowMs: NOW_MS + 1000 });
  assert.equal(response.status, 200, "Owner reapproval updates the existing stable product.");
  const republished = raw.prepare("SELECT title,pricing_model,price_cents,minimum_price_cents,suggested_price_cents,publication_state,revision FROM marketplace_products WHERE id='listing-task2ob-publish'").get();
  assert.deepEqual({ ...republished }, { title: "Revised Native Creator Product", pricing_model: "pwyw", price_cents: 1500, minimum_price_cents: 0, suggested_price_cents: 1500, publication_state: "published", revision: 3 });
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-publish'").get().n, 1, "Reapproval preserves stable product identity.");
  response = await publicCatalog.handlePublicCatalogRequest(new Request("https://example.com/api/catalog?slug=creator-native-publish"), env);
  const revisedPublicProduct = (await response.json()).product;
  assert.equal(revisedPublicProduct.title, "Revised Native Creator Product");
  assert.equal(revisedPublicProduct.pricingModel, "pwyw");
  assert.equal(revisedPublicProduct.suggestedPriceCents, 1500);

  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: revision, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Duplicate approval is safely rejected.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-publish'").get().n, 1);

  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-reject", expectedRevision: 1, action: "reject", note: "Owner rejected this disposable submission." }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  assert.equal(raw.prepare("SELECT lifecycle_state FROM creator_listings WHERE id='listing-task2ob-reject'").get().lifecycle_state, "rejected");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-reject'").get().n, 0);

  response = await creatorOperations.handleCreatorRequest(creatorApi("POST", "listings/listing-task2ob-withdraw/withdraw", { expectedRevision: 1 }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200, "A Creator can withdraw their own pending native submission.");
  assert.deepEqual({ ...raw.prepare("SELECT lifecycle_state,publication_state,revision FROM creator_listings WHERE id='listing-task2ob-withdraw'").get() }, { lifecycle_state: "draft", publication_state: "not_approved", revision: 2 });
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-withdraw'").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM creator_publication_audit WHERE listing_id='listing-task2ob-withdraw' AND action='submission_withdrawn'").get().n, 1);

  await acceptBoth(publication, raw, env, db, "listing-task2ob-conflict");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-conflict", expectedRevision: 3, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Conflicting slugs must not overwrite an existing product.");
  assert.deepEqual({ ...raw.prepare("SELECT lifecycle_state,publication_state,revision FROM creator_listings WHERE id='listing-task2ob-conflict'").get() }, { lifecycle_state: "submitted", publication_state: "not_approved", revision: 3 });

  await acceptBoth(publication, raw, env, db, "listing-task2ob-missing");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-missing", expectedRevision: 3, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Missing private assets block publication.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-missing'").get().n, 0);

  assert.equal(bucket.getPublicCalls, 2, "Only the public cover and its owning Creator's private cover were retrieved from R2.");
  seedListing(raw, bucket, "listing-task3b-generated", "creator-pdf-back-cover", "fixed", 800, null, null);
  raw.prepare("DELETE FROM creator_listing_files WHERE id=?").run("listing-task3b-generated-cover");
  const generatedFileId = "listing-task3b-generated-product";
  const generatedPrefix = `creator-quarantine/${CREATOR.id}/listing-task3b-generated`;
  const generatedCoverKey = `${generatedPrefix}/generated-cover.webp`;
  const generatedBackKey = `${generatedPrefix}/generated-back-cover.webp`;
  raw.prepare("UPDATE creator_listing_files SET generated_cover_key=?,generated_back_cover_key=?,pdf_page_count=122 WHERE id=?")
    .run(generatedCoverKey, generatedBackKey, generatedFileId);
  for (const [key, purpose] of [[generatedCoverKey, "generated-cover"], [generatedBackKey, "generated-back-cover"]]) {
    bucket.seed(key, Buffer.from("RIFF0000WEBP", "ascii"), { contentType: "image/webp" },
      { listingId: "listing-task3b-generated", purpose, uploadAttemptId: generatedFileId });
  }
  response = await publication.handleCreatorPublicationRequest(ownerPost({ action: "accept_file", fileId: generatedFileId, expectedRevision: 1 }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task3b-generated", expectedRevision: 2, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  const generatedProduct = raw.prepare("SELECT cover_r2_key,back_cover_r2_key,metadata_json FROM marketplace_products WHERE id='listing-task3b-generated'").get();
  assert.equal(generatedProduct.cover_r2_key, generatedCoverKey);
  assert.equal(generatedProduct.back_cover_r2_key, generatedBackKey);
  assert.equal(JSON.parse(generatedProduct.metadata_json).pageCount, 122);
  response = await publicAssets.handlePublicProductAssetRequest({ params: { slug: "creator-pdf-back-cover", asset: "back-cover.webp" }, env });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements").get().n, 0);
  raw.close();
  const reviewHtml = fs.readFileSync(path.join(ROOT, "owner", "creator-reviews.html"), "utf8");
  const script = reviewHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script); new Function(script);
  assert.match(reviewHtml, /Approve & Publish/);
  assert.match(reviewHtml, /x-csrf-token/);
  const creatorHtml = fs.readFileSync(path.join(ROOT, "creator", "index.html"), "utf8");
  const creatorScript = fs.readFileSync(path.join(ROOT, "assets", "js", "creator-dashboard.js"), "utf8");
  assert.match(creatorHtml, /id="creator-edit-form"/);
  assert.match(creatorHtml, /Save changes privately, then publish them when ready/);
  assert.match(creatorScript, /listings\/\$\{item.id\}\/publish/);
  assert.match(creatorScript, /Shelve/);
  assert.match(creatorScript, /expectedProductRevision/);
  assert.match(creatorScript, /Pause Sales/);
  assert.match(creatorScript, /Edit Listing/);
  new Function(creatorScript);
  console.log("Native Creator review/publication tests passed.");
  console.log("Owner auth + CSRF, Creator self-approval denial, native withdrawal, catalog listing, native pause, private edit, revision conflict, reapproval, rejection, duplicate, slug conflict, and missing-R2 safety: passed.");
}

async function acceptBoth(publication, raw, env, db, listingId) {
  let revision = 1;
  for (const row of raw.prepare("SELECT id FROM creator_listing_files WHERE listing_id=? ORDER BY purpose").all(listingId)) {
    const response = await publication.handleCreatorPublicationRequest(ownerPost({ action: "accept_file", fileId: row.id, expectedRevision: revision }), env, { database: db, nowMs: NOW_MS });
    assert.equal(response.status, 200); revision++;
  }
}

function seedListing(raw, bucket, id, slug, pricingModel, price, suggested, minimum) {
  raw.prepare(`INSERT INTO creator_listings(id,creator_id,slug,title,short_description,long_description,lifecycle_state,listed_price_cents,pricing_model,suggested_price_cents,minimum_price_cents,media_type,format_json,game_system,genre,discovery_json,publication_state,submitted_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'submitted',?,?,?,?, 'digital','["PDF"]','System Neutral','fantasy','{"language":"English"}','not_approved',?,?,?)`)
    .run(id, CREATOR.id, slug, `Title ${slug}`, "A complete short description.", "A complete long description for native publication.", price, pricingModel, suggested, minimum, NOW, NOW, NOW);
  raw.prepare("INSERT INTO creator_listing_declarations(listing_id,creator_id,declared_by_user_id,submission_key,rights_confirmed,representation_confirmed,licenses_confirmed,declared_at) VALUES(?,?,?, ?,1,1,1,?)")
    .run(id, CREATOR.id, CREATOR.userId, `${id}-declaration`, NOW);
  const coverKey = `creator-quarantine/${CREATOR.id}/${id}/cover.webp`, productKey = `creator-quarantine/${CREATOR.id}/${id}/product.pdf`;
  const cover = Buffer.from("RIFF0000WEBP", "ascii"), pdf = Buffer.from("%PDF-1.7\nTask 2O-B\n%%EOF", "utf8");
  for (const file of [
    { id: `${id}-cover`, purpose: "cover", name: "cover.webp", type: "image/webp", key: coverKey, bytes: cover },
    { id: `${id}-product`, purpose: "product", name: "product.pdf", type: "application/pdf", key: productKey, bytes: pdf }
  ]) {
    raw.prepare("INSERT INTO creator_listing_files(id,listing_id,creator_id,purpose,original_filename,normalized_filename,content_type,size_bytes,quarantine_key,validation_state,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,'uploaded',?)")
      .run(file.id, id, CREATOR.id, file.purpose, file.name, file.name, file.type, file.bytes.length, file.key, NOW);
    bucket.seed(file.key, file.bytes, { contentType: file.type }, { listingId: id, purpose: file.purpose, scanState: "pending", uploadAttemptId: file.id });
  }
}

async function seedIdentities(raw, auth) {
  for (const user of [
    { id: OWNER.id, email: "owner-task2ob@example.invalid", role: "owner", token: OWNER.token, csrf: OWNER.csrf },
    { id: CREATOR.userId, email: "creator-task2ob@example.invalid", role: "user", token: CREATOR.token, csrf: CREATOR.csrf }
  ]) {
    raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)").run(user.id, user.email, user.role, NOW, NOW);
    raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)")
      .run(`${user.id}-session`, user.id, await auth.hashToken(user.token), await auth.hashToken(user.csrf), NOW, EXPIRES, NOW);
  }
  raw.prepare(`INSERT INTO marketplace_creators(id,slug,display_name,short_bio,long_bio,profile_template,marketplace_status,registration_status,registration_completed_at,intake_registration_completed_at,created_at,updated_at)
    VALUES(?,?,?,'Short bio','Long bio','catalog','approved','active',?,?,?,?)`).run(CREATOR.id, "creator-task2ob", "Creator Task 2O-B", NOW, NOW, NOW, NOW);
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)").run(CREATOR.userId, CREATOR.id, NOW);
  raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','not_required','primary_free',?,?)").run(CREATOR.id, CREATOR.userId, NOW, NOW);
  raw.prepare("INSERT INTO user_account_profiles(user_id,legal_name,payment_method_status,payment_method_status_updated_at,created_at,updated_at) VALUES(?,?,'ready',?,?,?)").run(CREATOR.userId, "Creator Task 2O-B", NOW, NOW, NOW);
  raw.prepare(`INSERT INTO creator_registration_details(creator_id,legal_name,business_name,business_type,country,state_region,address_line1,city,postal_code,contact_email,rights_confirmation_at,created_at,updated_at)
    VALUES(?,?,'','individual','US','NC','1 Test Road','Durham','27701','creator-task2ob@example.invalid',?,?,?)`).run(CREATOR.id, "Creator Task 2O-B", NOW, NOW, NOW);
  raw.prepare("INSERT INTO creator_agreement_acceptances(creator_id,accepted_by_user_id,agreement_id,agreement_version,accepted_at,source_context) VALUES(?,?,'trg-creator-marketplace-agreement','2026-08-27',?,'task2ob_test')").run(CREATOR.id, CREATOR.userId, NOW);
  raw.prepare("INSERT INTO creator_payout_profiles(creator_id,provider,onboarding_status,payouts_enabled,verification_status,status_updated_at) VALUES(?,'manual','complete',1,'verified',?)").run(CREATOR.id, NOW);
}

function ownerGet() { return new Request("https://example.com/owner/api/creator-reviews", { headers: { cookie: `__Host-trg_session=${OWNER.token}; trg_account_csrf=${OWNER.csrf}` } }); }
function ownerPost(body, csrf = OWNER.csrf) { return post(body, OWNER.token, csrf); }
function creatorPost(body) { return post(body, CREATOR.token, CREATOR.csrf); }
function creatorApi(method, route, body) {
  return new Request(`https://example.com/api/creator/${route}`, {
    method,
    headers: {
      origin: "https://example.com",
      cookie: `__Host-trg_session=${CREATOR.token}; trg_account_csrf=${CREATOR.csrf}`,
      ...(method === "POST" ? { "x-csrf-token": CREATOR.csrf, "content-type": "application/json" } : {})
    },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined
  });
}
function post(body, token, csrf) { return new Request("https://example.com/owner/api/creator-reviews", { method: "POST", headers: { origin: "https://example.com", cookie: `__Host-trg_session=${token}; trg_account_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify(body) }); }
function applyMigrations(raw) { for (const name of fs.readdirSync(path.join(ROOT, "migrations")).filter(name => name.endsWith(".sql")).sort()) raw.exec(fs.readFileSync(path.join(ROOT, "migrations", name), "utf8")); }
function load(relative) { return import(`${pathToFileURL(path.join(ROOT, relative)).href}?v=${Date.now()}-${Math.random()}`); }
function r2() {
  const map = new Map();
  return {
    getPublicCalls: 0,
    seed(key, bytes, httpMetadata, customMetadata) { map.set(key, { bytes: Buffer.from(bytes), httpMetadata, customMetadata }); },
    async head(key) { const row = map.get(key); return row ? { size: row.bytes.length, objectSize: row.bytes.length, httpMetadata: row.httpMetadata, customMetadata: row.customMetadata } : null; },
    async get(key) { this.getPublicCalls++; const row = map.get(key); return row ? { body: row.bytes, size: row.bytes.length, objectSize: row.bytes.length, httpMetadata: row.httpMetadata, customMetadata: row.customMetadata } : null; },
    deleteSync(key) { map.delete(key); }
  };
}
function d1(raw) {
  const api = { raw, prepare(sql) { let values = []; return { bind(...next) { values = next; return this; }, async first() { return raw.prepare(sql).get(...values) || null; }, async all() { return { results: raw.prepare(sql).all(...values) }; }, async run() { const result = raw.prepare(sql).run(...values); return { changes: Number(result.changes), meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; } }; }, async batch(statements) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  return api;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
