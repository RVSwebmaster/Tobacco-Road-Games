import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { PUBLICATION_UNAVAILABLE } from "./publication-unavailable.mjs";
import { prepareUpdateProduct, ProductCatalogError } from "./product-catalog-d1.mjs";

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
  if (action === "pause_publication") return pausePublication(body, db, auth, options);
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

async function pausePublication(body, db, auth, options) {
  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=?").bind(String(body.listingId || "")).first();
  return pauseListingPublication({
    listing,
    database: db,
    actorType: "operator",
    actorId: auth.username,
    expectedListingRevision: body.expectedRevision,
    expectedProductRevision: body.expectedProductRevision,
    nowMs: options.nowMs,
  });
}

export async function pauseListingPublication({
  listing,
  database,
  actorType = "system",
  actorId = "system",
  expectedListingRevision,
  expectedProductRevision,
  nowMs = Date.now(),
} = {}) {
  if (!listing?.public_product_slug) return json({ error: "Published listing not found." }, 404);
  if (!database?.prepare) return unavailable();
  if (listing.lifecycle_state !== "active" || listing.publication_state !== "published") {
    return json({ error: "Only an active published listing can be taken off sale.", code: "listing_not_published" }, 409);
  }
  const product = await database.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=?").bind(listing.id).first();
  if (!product) return unavailable();
  const listingRevision = expectedListingRevision === undefined ? Number(listing.revision) : Number(expectedListingRevision);
  const productRevision = expectedProductRevision === undefined ? Number(product.revision) : Number(expectedProductRevision);
  if (!Number.isInteger(listingRevision) || listingRevision < 1 || !Number.isInteger(productRevision) || productRevision < 1) {
    return json({ error: "Current listing and product revisions are required.", code: "invalid_request" }, 400);
  }
  if (listingRevision !== Number(listing.revision) || productRevision !== Number(product.revision)) {
    return json({ error: "The listing changed after it was loaded.", code: "revision_conflict", listingRevision: Number(listing.revision), productRevision: Number(product.revision) }, 409);
  }
  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const nextListingRevision = listingRevision + 1;
  try {
    const prepared = await prepareUpdateProduct(database, product.id, { publicationState: "paused" }, {
      expectedRevision: productRevision,
      nowMs,
      creatorTransition: {
        listingId: listing.id,
        listingRevision: nextListingRevision,
        lifecycleState: "paused",
        publicationState: "paused",
      },
    });
    const nextProductRevision = prepared.expectedNextRevision;
    await database.batch([
      database.prepare(`UPDATE creator_listings SET lifecycle_state='paused',publication_state='paused',updated_at=?,revision=revision+1
        WHERE id=? AND lifecycle_state='active' AND publication_state='published' AND revision=?`)
        .bind(now, listing.id, listingRevision),
      prepared.statement,
      database.prepare(`INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at)
        VALUES((SELECT cl.id FROM creator_listings cl JOIN marketplace_products mp ON mp.creator_listing_id=cl.id
          WHERE cl.id=? AND cl.lifecycle_state='paused' AND cl.publication_state='paused' AND cl.revision=?
            AND mp.id=? AND mp.publication_state='paused' AND mp.revision=?),?,?,?,?,?,?)`)
        .bind(listing.id, nextListingRevision, product.id, nextProductRevision, listing.creator_id, actorType, actorId, "publication_paused", JSON.stringify({ productId: product.id, productRevision: nextProductRevision }), now),
    ]);
    return json({ ok: true, state: "paused", revision: nextListingRevision, productRevision: nextProductRevision });
  } catch (cause) {
    if (cause instanceof ProductCatalogError && cause.code === "conflict") {
      return json({ error: "The listing changed after it was loaded.", code: "revision_conflict" }, 409);
    }
    if (/NOT NULL constraint failed: creator_publication_audit\.listing_id/i.test(String(cause?.message || cause))) {
      return json({ error: "The listing changed after it was loaded.", code: "revision_conflict" }, 409);
    }
    console.error(JSON.stringify({ event: "creator_publication_pause_failed", listingId: listing.id, message: String(cause?.message || cause) }));
    return json({ error: "The native product could not be paused.", code: "pause_failed" }, 503);
  }
}

function unavailable() { return json({ error: PUBLICATION_UNAVAILABLE }, 503); }
function audit(db, listingId, creatorId, actor, action, context, now, actorType = "operator") {
  return db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(listingId, creatorId, actorType, actor, action, JSON.stringify(context), now);
}
async function rows(statement) { const result = await statement.all(); return result.results || []; }
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } }); }
