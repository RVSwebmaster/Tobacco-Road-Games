const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  NOW_MS,
  PDF_BYTES,
  COVER_BYTES,
  createCreator,
  creatorRequest,
  applyMigrations,
  createD1,
  load,
} = require("./test-creator-product-withdrawal.js");

const RV = {
  id: "creator-rv-sawyer",
  userId: "rv-sawyer-user",
  slug: "rv-sawyer",
  session: "rv-sawyer-session",
  csrf: "rv-sawyer-csrf",
};
const ORDINARY = {
  id: "creator-ordinary",
  userId: "ordinary-user",
  slug: "ordinary-creator",
  session: "ordinary-session",
  csrf: "ordinary-csrf",
};

async function main() {
  const registration = await load("functions/_lib/creator-registration.mjs");
  const operations = await load("functions/_lib/creator-operations.mjs");
  const files = await load("functions/_lib/creator-files.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON;");
  applyMigrations(raw);
  const db = createD1(raw);
  const auth = await load("functions/_lib/account-auth.mjs");
  await createExistingRv(raw, auth);
  await createCreator(raw, auth, ORDINARY);
  for (const creator of [RV, ORDINARY]) clearCommercialOnboarding(raw, creator);

  const rvReadiness = await registration.getCreatorPublicationEligibility(db, RV.id);
  assert.equal(rvReadiness.publicationEligible, true, "Legacy RV identity must retain publication authority.");
  assert.equal(rvReadiness.payoutReady, false);
  assert.equal(rvReadiness.paymentMethodReady, false);
  assert.equal(rvReadiness.agreementCurrent, false);
  assert.equal((await registration.getCreatorOperationalEligibility(db, RV.id)).eligible, false);

  const env = { TRG_ORDERS: db, TRG_PRODUCTS: memoryBucket() };
  const rvListing = await createAndPublish({ creator: RV, title: "RV Preview", priceCents: 0, operations, files, env, db });
  const ordinaryReadiness = await registration.getCreatorPublicationEligibility(db, ORDINARY.id);
  assert.equal(ordinaryReadiness.publicationEligible, true, "Ordinary approved Creator must receive the same publication authority.");
  const ordinaryListing = await createAndPublish({ creator: ORDINARY, title: "Ordinary Preview", priceCents: 0, operations, files, env, db });

  let response = await operations.handleCreatorRequest(
    creatorRequest(RV, `listings/${ordinaryListing}/publish`, { expectedRevision: 1, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }),
    env,
    { database: db, nowMs: NOW_MS },
  );
  assert.equal(response.status, 404, "A Creator cannot publish another Creator's listing.");

  raw.prepare("UPDATE marketplace_creators SET registration_status='suspended' WHERE id=?").run(ORDINARY.id);
  response = await operations.handleCreatorRequest(
    creatorRequest(ORDINARY, "listings", { title: "Suspended Draft", priceCents: 0, pricingModel: "free" }),
    env,
    { database: db, nowMs: NOW_MS },
  );
  assert.equal(response.status, 403, "Suspended Creators cannot create listings.");
  raw.prepare("UPDATE marketplace_creators SET registration_status='active' WHERE id=?").run(ORDINARY.id);

  const paidListing = await createDraft({ creator: RV, title: "Paid Without Readiness", priceCents: 500, pricingModel: "fixed", operations, env, db });
  await uploadProduct({ creator: RV, listingId: paidListing, files, env, db });
  response = await operations.handleCreatorRequest(
    creatorRequest(RV, `listings/${paidListing}/publish`, { expectedRevision: 1, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }),
    env,
    { database: db, nowMs: NOW_MS },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /commercial readiness/i, "Selling remains gated by commercial readiness.");
  assert.ok(raw.prepare("SELECT id FROM marketplace_products WHERE creator_listing_id=?").get(rvListing));
  console.log("Creator publication authority, legacy compatibility, ownership, suspension, preview-only publishing, and commercial gating tests passed.");
}

function clearCommercialOnboarding(raw, creator) {
  raw.prepare("DELETE FROM creator_registration_details WHERE creator_id=?").run(creator.id);
  raw.prepare("DELETE FROM creator_agreement_acceptances WHERE creator_id=?").run(creator.id);
  raw.prepare("DELETE FROM creator_payout_profiles WHERE creator_id=?").run(creator.id);
  raw.prepare("DELETE FROM user_account_profiles WHERE user_id=?").run(creator.userId);
}
async function createExistingRv(raw, auth) {
  const now = new Date(NOW_MS).toISOString();
  raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active','owner',?,?)").run(RV.userId, "rv-sawyer@example.invalid", now, now);
  raw.prepare("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").run(`${RV.id}-session`, RV.userId, await auth.hashToken(RV.session), await auth.hashToken(RV.csrf), now, new Date(NOW_MS + 365 * 86400000).toISOString(), now);
  raw.prepare("INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)").run(RV.userId, RV.id, now);
  raw.prepare("INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,'primary','active','legacy_grandfathered','legacy_grandfathered',?,?)").run(RV.id, RV.userId, now, now);
  raw.prepare("UPDATE marketplace_creators SET marketplace_status='approved',registration_status='active',intake_registration_completed_at=COALESCE(intake_registration_completed_at,?),registration_completed_at=COALESCE(registration_completed_at,?) WHERE id=?").run(now, now, RV.id);
}
async function createAndPublish({ creator, title, priceCents, operations, files, env, db }) {
  const listingId = await createDraft({ creator, title, priceCents, pricingModel: priceCents ? "fixed" : "free", operations, env, db });
  await uploadProduct({ creator, listingId, files, env, db });
  const response = await operations.handleCreatorRequest(
    creatorRequest(creator, `listings/${listingId}/publish`, { expectedRevision: 1, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true }),
    env,
    { database: db, nowMs: NOW_MS },
  );
  assert.equal(response.status, 200, await response.text());
  return listingId;
}
async function createDraft({ creator, title, priceCents, pricingModel, operations, env, db }) {
  const response = await operations.handleCreatorRequest(
    creatorRequest(creator, "listings", { slug: `${creator.slug}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, shortDescription: "A preview publication.", longDescription: "A disposable preview publication for authority testing.", priceCents, pricingModel, mediaType: "digital", format: ["PDF"], gameSystem: "System Neutral", genre: "test" }),
    env,
    { database: db, nowMs: NOW_MS },
  );
  const text = await response.text();
  assert.equal(response.status, 201, text);
  return JSON.parse(text).listing.id;
}
async function uploadProduct({ creator, listingId, files, env, db }) {
  const form = new FormData();
  form.set("purpose", "product");
  form.set("file", new File([PDF_BYTES], "publication.pdf", { type: "application/pdf" }));
  form.set("generatedFront", new File([COVER_BYTES], "front.webp", { type: "image/webp" }));
  form.set("generatedBack", new File([COVER_BYTES], "back.webp", { type: "image/webp" }));
  form.set("pdfPageCount", "4");
  const response = await files.handleCreatorFileUpload(
    new Request(`https://example.com/api/creator/listings/${listingId}/files`, { method: "POST", headers: { origin: "https://example.com", cookie: `__Host-trg_session=${creator.session}; trg_account_csrf=${creator.csrf}`, "x-csrf-token": creator.csrf }, body: form }),
    env,
    listingId,
    { database: db, nowMs: NOW_MS },
  );
  assert.equal(response.status, 201, await response.text());
}
function memoryBucket() {
  const objects = new Map();
  const read = (key) => { const row = objects.get(key); return row ? { body: row.bytes, size: row.bytes.length, objectSize: row.bytes.length, httpMetadata: row.httpMetadata, customMetadata: row.customMetadata } : null; };
  return { async put(key, value, options = {}) { objects.set(key, { bytes: Buffer.from(value), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata }); }, async get(key) { return read(key); }, async head(key) { return read(key); }, async delete(key) { objects.delete(key); } };
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
