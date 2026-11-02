import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { PUBLICATION_UNAVAILABLE } from "./publication-unavailable.mjs";

export async function handleCreatorPublicationRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const db = options.database || env.TRG_ORDERS;
  let session;
  try { session = await getSessionFromRequest(request, { ...env, TRG_ORDERS: db }, options.sessionOptions || options); }
  catch { return json({ error: "Owner session could not be verified.", code: "session_unavailable" }, 503); }
  if (!session.valid) return json({ error: "Sign in as an Owner to review Creator files.", code: "authentication_required" }, 401);
  if (!["owner", "admin"].includes(session.user.role)) return json({ error: "Only an Owner may review Creator files.", code: "owner_required" }, 403);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) return json({ error: "The Owner file-review request could not be verified.", code: "csrf_rejected" }, 403);
  const auth = { username: session.user.id };
  let body = {};
  try { body = await request.json(); } catch { /* Invalid actions are rejected below. */ }
  const action = String(body.action || "");
  const now = new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString();

  if (action === "accept_file" || action === "reject_file") {
    const file = await db.prepare("SELECT * FROM creator_listing_files WHERE id=?").bind(String(body.fileId || "")).first();
    if (!file) return json({ error: "Creator file not found." }, 404);
    if (!["uploaded", "validating"].includes(file.validation_state)) return json({ error: "That file has already received an Owner decision.", code: "file_already_reviewed" }, 409);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json({ error: "A current listing revision is required.", code: "invalid_request" }, 400);
    const listing = await db.prepare("SELECT revision,lifecycle_state,publication_state FROM creator_listings WHERE id=?").bind(file.listing_id).first();
    if (!listing || listing.lifecycle_state !== "submitted" || listing.publication_state !== "not_approved") return json({ error: "Only a pending submission can have files reviewed.", code: "listing_not_reviewable" }, 409);
    if (Number(listing.revision) !== expectedRevision) return json({ error: "The listing changed after it was loaded.", code: "revision_conflict", listing }, 409);
    const state = action === "accept_file" ? "accepted" : "rejected";
    const message = String(body.message || "").slice(0, 1000);
    await db.batch([
      db.prepare("UPDATE creator_listing_files SET validation_state=?,validation_message=?,validated_at=? WHERE id=? AND validation_state IN ('uploaded','validating') AND EXISTS (SELECT 1 FROM creator_listings WHERE id=? AND revision=? AND lifecycle_state='submitted' AND publication_state='not_approved')").bind(state, message, now, file.id, file.listing_id, expectedRevision),
      db.prepare("UPDATE creator_listings SET updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND lifecycle_state='submitted' AND publication_state='not_approved'").bind(now, file.listing_id, expectedRevision),
      audit(db, file.listing_id, file.creator_id, auth.username, `file_${state}`, { fileId: file.id, purpose: file.purpose, message }, now)
    ]);
    return json({ ok: true, state, revision: expectedRevision + 1 });
  }
  if (action === "approve_bundle") return approveBundle(body, db, auth, now);
  if (action === "publish_bundle") return publishBundle(body, db);
  if (action === "pause_publication") return pausePublication(body, db);
  if (action !== "publish") return json({ error: "Publication action is invalid." }, 400);

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
