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
  bucket.deleteSync("creator-quarantine/creator-task2ob/listing-task2ob-missing/product.pdf");
  await catalog.createProduct(db, {
    id: "existing-task2ob-product", slug: "creator-native-conflict", creatorId: CREATOR.id,
    publicationState: "published", title: "Existing product", status: "available-direct",
    buyMode: "cart", pricingModel: "fixed", priceCents: 500
  }, { nowMs: NOW_MS });

  let response = await review.handleCreatorReviewRequest(ownerGet(), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  let queue = await response.json();
  assert.equal(queue.listings.filter(row => row.creator_id === CREATOR.id).length, 4);
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

  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-publish", expectedRevision: revision, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Duplicate approval is safely rejected.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-publish'").get().n, 1);

  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-reject", expectedRevision: 1, action: "reject", note: "Owner rejected this disposable submission." }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 200);
  assert.equal(raw.prepare("SELECT lifecycle_state FROM creator_listings WHERE id='listing-task2ob-reject'").get().lifecycle_state, "rejected");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-reject'").get().n, 0);

  await acceptBoth(publication, raw, env, db, "listing-task2ob-conflict");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-conflict", expectedRevision: 3, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Conflicting slugs must not overwrite an existing product.");
  assert.deepEqual({ ...raw.prepare("SELECT lifecycle_state,publication_state,revision FROM creator_listings WHERE id='listing-task2ob-conflict'").get() }, { lifecycle_state: "submitted", publication_state: "not_approved", revision: 3 });

  await acceptBoth(publication, raw, env, db, "listing-task2ob-missing");
  response = await review.handleCreatorReviewRequest(ownerPost({ listingId: "listing-task2ob-missing", expectedRevision: 3, action: "approve" }), env, { database: db, nowMs: NOW_MS });
  assert.equal(response.status, 409, "Missing private assets block publication.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM marketplace_products WHERE id='listing-task2ob-missing'").get().n, 0);

  assert.equal(bucket.getPublicCalls, 1, "Only the approved public cover was retrieved from R2.");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM orders").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM download_entitlements").get().n, 0);
  raw.close();
  const reviewHtml = fs.readFileSync(path.join(ROOT, "owner", "creator-reviews.html"), "utf8");
  const script = reviewHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script); new Function(script);
  assert.match(reviewHtml, /Approve & Publish/);
  assert.match(reviewHtml, /x-csrf-token/);
  console.log("Native Creator review/publication tests passed.");
  console.log("Owner auth + CSRF, Creator self-approval denial, revision conflict, approval, rejection, duplicate, slug conflict, and missing-R2 safety: passed.");
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
