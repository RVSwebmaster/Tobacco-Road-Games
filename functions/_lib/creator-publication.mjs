import { OWNER_ACTOR_ID } from "./owner-runtime.mjs";
import { mapApprovedListingToPublishPayload } from "./creator-publication-map.mjs";
import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";
import { assertPublicationCapacity } from "./marketplace-policy.mjs";
import { assertCreatorPublicationReadiness } from "./publication-readiness.mjs";
import { PUBLICATION_UNAVAILABLE } from "./publication-unavailable.mjs";

export async function handleCreatorPublicationRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const db = options.database || env.TRG_ORDERS;
  const auth = { username: OWNER_ACTOR_ID };
  let body = {};
  try { body = await request.json(); } catch { /* Invalid actions are rejected below. */ }
  const action = String(body.action || "");
  const now = new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString();

  if (action === "accept_file" || action === "reject_file") {
    const file = await db.prepare("SELECT * FROM creator_listing_files WHERE id=?").bind(String(body.fileId || "")).first();
    if (!file) return json({ error: "Creator file not found." }, 404);
    const state = action === "accept_file" ? "accepted" : "rejected";
    const message = String(body.message || "").slice(0, 1000);
    await db.batch([
      db.prepare("UPDATE creator_listing_files SET validation_state=?,validation_message=?,validated_at=? WHERE id=? AND validation_state IN ('uploaded','validating')").bind(state, message, now, file.id),
      db.prepare("UPDATE creator_listings SET publication_state=CASE WHEN ?='accepted' THEN 'approved' ELSE 'waiting_for_files' END WHERE id=? AND publication_state IN ('approved','waiting_for_files')").bind(state, file.listing_id),
      audit(db, file.listing_id, file.creator_id, auth.username, `file_${state}`, { fileId: file.id, purpose: file.purpose, message }, now)
    ]);
    return json({ ok: true, state });
  }
  if (action === "approve_bundle") return approveBundle(body, db, auth, now);
  if (action === "publish_bundle") return publishBundle(body, db);
  if (action === "pause_publication") return pausePublication(body, db);
  if (action !== "publish") return json({ error: "Publication action is invalid." }, 400);

  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=?").bind(String(body.listingId || "")).first();
  if (!listing) return json({ error: "Listing not found." }, 404);
  if (Number(listing.owner_review_hold) === 1) return json({ error: "Clear the Owner Review Hold before publishing this listing." }, 409);
  try {
    await assertPublicationCapacity(db, listing, Number.isFinite(options.nowMs) ? options.nowMs : Date.now());
    await assertCreatorPublicationReadiness(db, listing);
  } catch (error) {
    return json({ error: error.message }, 409);
  }
  const creator = await db.prepare("SELECT * FROM marketplace_creators WHERE id=?").bind(listing.creator_id).first();
  const files = await rows(db.prepare("SELECT * FROM creator_listing_files WHERE listing_id=? ORDER BY uploaded_at DESC").bind(listing.id));
  const mapped = mapApprovedListingToPublishPayload(listing, creator, files, { nowMs: options.nowMs });
  const existing = getRuntimeCatalogProduct(mapped.metadata?.slug);
  if (existing && listing.source_product_slug !== mapped.metadata.slug) mapped.errors.push("The public product slug already belongs to another listing.");
  if (mapped.errors.length) {
    await db.prepare("UPDATE creator_listings SET publication_errors_json=?,publication_state=CASE WHEN publication_state='approved' THEN 'waiting_for_files' ELSE publication_state END WHERE id=?").bind(JSON.stringify(mapped.errors), listing.id).run();
    return json({ error: "Listing is not safe to publish.", validationErrors: mapped.errors }, 409);
  }
  return unavailable();
}

async function approveBundle(body, db, auth, now) {
  const bundle = await db.prepare("SELECT id,creator_id FROM creator_bundles WHERE id=?").bind(String(body.bundleId || "")).first();
  if (!bundle) return json({ error: "Bundle not found." }, 404);
  await db.batch([
    db.prepare("UPDATE creator_bundles SET publication_state='approved',updated_at=? WHERE id=?").bind(now, bundle.id),
    db.prepare("INSERT INTO creator_bundle_publication_audit(bundle_id,creator_id,actor_id,action,context_json,created_at) VALUES(?,?,?,'approved','{}',?)").bind(bundle.id, bundle.creator_id, auth.username, now)
  ]);
  return json({ ok: true, state: "approved" });
}

async function publishBundle(body, db) {
  const bundle = await db.prepare("SELECT * FROM creator_bundles WHERE id=?").bind(String(body.bundleId || "")).first();
  if (!bundle) return json({ error: "Bundle not found." }, 404);
  if (bundle.publication_state !== "approved") return json({ error: "Bundle requires operator approval before publication." }, 409);
  const listings = await rows(db.prepare("SELECT cl.id,cl.creator_id,cl.public_product_slug,cl.publication_state,cl.owner_review_hold FROM creator_bundle_items bi JOIN creator_listings cl ON cl.id=bi.listing_id WHERE bi.bundle_id=?").bind(bundle.id));
  if (listings.length < 2 || listings.some(item => item.creator_id !== bundle.creator_id || item.publication_state !== "published" || !item.public_product_slug || Number(item.owner_review_hold) === 1)) {
    return json({ error: "Bundles require at least two published, saleable products owned by the same creator." }, 409);
  }
  return unavailable();
}

async function pausePublication(body, db) {
  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=?").bind(String(body.listingId || "")).first();
  return pauseListingPublication({ listing });
}

export async function pauseListingPublication({ listing } = {}) {
  if (!listing?.public_product_slug) return json({ error: "Published listing not found." }, 404);
  return unavailable();
}

function unavailable() { return json({ error: PUBLICATION_UNAVAILABLE }, 503); }
function audit(db, listingId, creatorId, actor, action, context, now, actorType = "operator") {
  return db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(listingId, creatorId, actorType, actor, action, JSON.stringify(context), now);
}
async function rows(statement) { const result = await statement.all(); return result.results || []; }
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } }); }
