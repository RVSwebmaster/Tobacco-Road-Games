import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { mapApprovedListingToPublishPayload } from "./creator-publication-map.mjs";
import { assertPublicationCapacity } from "./marketplace-policy.mjs";
import { prepareCreateProduct, prepareUpdateProduct } from "./product-catalog-d1.mjs";
import { assertCreatorPublicationReadiness } from "./publication-readiness.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const OWNER_ROLES = new Set(["owner", "admin"]);
const DISCOVERY_FIELDS = ["playerCountMin", "playerCountMax", "gmMode", "prepBurden", "playDuration", "playMode", "rulesComplexity", "language", "contentDescriptors"];

export class CreatorReviewError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}

export async function handleCreatorReviewRequest(request, env = {}, options = {}) {
  const database = options.database || env.TRG_ORDERS;
  if (!database?.prepare) return failure("bindings_unavailable", "Creator review database is unavailable.", 503);
  if (!["GET", "POST"].includes(request.method)) return failure("method_not_allowed", "Use GET or POST.", 405);
  let session;
  try {
    session = await getSessionFromRequest(request, { ...env, TRG_ORDERS: database }, options.sessionOptions || options);
  } catch (cause) {
    console.error(JSON.stringify({ event: "creator_review_session_failed", message: String(cause?.message || cause) }));
    return failure("session_unavailable", "Owner session could not be verified.", 503);
  }
  if (!session.valid) return failure("authentication_required", "Sign in as an Owner to review Creator products.", 401);
  if (!OWNER_ROLES.has(session.user.role)) return failure("owner_required", "Only an Owner may review Creator products.", 403);
  if (request.method === "GET") return reviewQueue(database, session.csrfToken);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return failure("csrf_rejected", "The Owner review request could not be verified.", 403);
  }
  let body;
  try { body = await request.json(); } catch { return failure("invalid_request", "Review request is invalid.", 400); }
  const action = String(body?.action || "");
  if (!["approve", "request_changes", "reject"].includes(action)) return failure("invalid_action", "Review action is invalid.", 400);
  const listingId = String(body.listingId || ""), expectedRevision = Number(body.expectedRevision);
  if (!listingId || !Number.isInteger(expectedRevision) || expectedRevision < 1) return failure("invalid_request", "A current listing revision is required.", 400);
  const note = String(body.note || "").trim().slice(0, 2000);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now(), now = new Date(nowMs).toISOString();
  try {
    if (action === "approve") {
      const product = await publishApprovedCreatorListing(database, env.TRG_PRODUCTS, { listingId, expectedRevision, note, actorId: session.user.id, nowMs });
      return jsonResponse({ ok: true, state: "published", product, reviewedBy: session.user.id });
    }
    const nextState = action === "reject" ? "rejected" : "needs_changes";
    const result = await database.prepare(`UPDATE creator_listings
      SET lifecycle_state=?,publication_state='not_approved',reviewed_at=?,review_note=?,updated_at=?,revision=revision+1
      WHERE id=? AND lifecycle_state='submitted' AND publication_state='not_approved' AND revision=?`)
      .bind(nextState, now, note, now, listingId, expectedRevision).run();
    if (changes(result) !== 1) return revisionConflict(database, listingId);
    const listing = await database.prepare("SELECT creator_id,revision FROM creator_listings WHERE id=?").bind(listingId).first();
    await database.batch([
      database.prepare("INSERT INTO creator_review_audit(listing_id,creator_id,actor_user_id,action,note,created_at) VALUES(?,?,?,?,?,?)")
        .bind(listingId, listing.creator_id, session.user.id, action, note, now),
      audit(database, listingId, listing.creator_id, session.user.id, action, { note, revision: listing.revision }, now)
    ]);
    return jsonResponse({ ok: true, state: nextState, revision: listing.revision, reviewedBy: session.user.id });
  } catch (cause) {
    if (cause instanceof CreatorReviewError) return failure(cause.code, cause.message, cause.status, cause.details);
    if (/UNIQUE constraint failed: marketplace_products\.(?:id|slug)/i.test(String(cause?.message || cause))) return failure("product_conflict", "A native product already uses this product ID or slug.", 409);
    if (/NOT NULL constraint failed: creator_review_audit\.listing_id/i.test(String(cause?.message || cause))) return revisionConflict(database, listingId);
    console.error(JSON.stringify({ event: "creator_review_failed", listingId, action, message: String(cause?.message || cause) }));
    return failure("review_failed", "The Creator review decision could not be completed.", 503);
  }
}

export async function publishCreatorListing(database, bucket, input) {
  if (!bucket?.head) throw new CreatorReviewError("storage_unavailable", "Private Creator storage is unavailable.", 503);
  const listing = await database.prepare("SELECT * FROM creator_listings WHERE id=?").bind(input.listingId).first();
  if (!listing) throw new CreatorReviewError("listing_not_found", "Submitted listing not found.", 404);
  const direct = input.requireSubmitted === false;
  if (direct
    ? !["draft", "needs_changes", "paused", "active"].includes(listing.lifecycle_state)
      || (listing.lifecycle_state === "active" && listing.publication_state !== "published")
      || (!["draft", "needs_changes", "paused"].includes(listing.lifecycle_state) && listing.publication_state !== "published")
    : (listing.lifecycle_state !== "submitted" || listing.publication_state !== "not_approved")) {
    throw new CreatorReviewError("listing_not_reviewable", direct ? "This Creator listing cannot be published from its current state." : "Listing is no longer awaiting review.", 409, { revision: listing.revision });
  }
  if (Number(listing.revision) !== input.expectedRevision) throw new CreatorReviewError("revision_conflict", "The listing changed after it was loaded.", 409, { revision: listing.revision });
  if (Number(listing.owner_review_hold) === 1) throw new CreatorReviewError("review_hold", "Clear the Owner Review Hold before publication.", 409);
  try {
    await assertPublicationCapacity(database, listing, input.nowMs);
    await assertCreatorPublicationReadiness(database, listing);
  } catch (cause) {
    throw new CreatorReviewError("creator_unavailable", cause.message, 409);
  }
  const creator = await database.prepare("SELECT * FROM marketplace_creators WHERE id=?").bind(listing.creator_id).first();
  if (!creator || creator.marketplace_status !== "approved" || creator.registration_status !== "active" || creator.closure_state !== "active") throw new CreatorReviewError("creator_unavailable", "The Creator is not currently approved and active.", 409);
  const fileRows = await database.prepare("SELECT * FROM creator_listing_files WHERE listing_id=? AND validation_state<>'superseded' ORDER BY uploaded_at DESC").bind(listing.id).all();
  const mapped = mapApprovedListingToPublishPayload(listing, creator, fileRows.results || [], { nowMs: input.nowMs, requireSubmitted: !direct, acceptableFileStates: direct ? ["uploaded", "validating", "accepted"] : ["accepted"] });
  if (!mapped.valid) throw new CreatorReviewError("publication_invalid", "Listing is not safe to publish.", 409, { validationErrors: mapped.errors });
  if (mapped.files.product.generated_cover_key) {
    await verifyGeneratedObject(bucket, mapped.files.product, "generated_cover_key", "generated-cover");
    if (mapped.files.product.generated_back_cover_key) {
      await verifyGeneratedObject(bucket, mapped.files.product, "generated_back_cover_key", "generated-back-cover");
    }
  } else {
    await verifyAcceptedObject(bucket, mapped.files.cover, "cover");
  }
  await verifyAcceptedObject(bucket, mapped.files.product, "product");

  const publishedAt = new Date(input.nowMs).toISOString(), metadata = mapped.metadata;
  const productInput = {
    id: metadata.id, slug: metadata.slug, creatorId: metadata.creatorId, creatorListingId: listing.id,
    publicationState: "published", listingVisibility: input.listingVisibility || "unlisted", title: metadata.title, subtitle: metadata.subtitle,
    shortDescription: metadata.shortDescription, longDescription: metadata.longDescription,
    publisher: metadata.publisher, gameSystem: metadata.gameSystem, productLine: metadata.productLine,
    genre: metadata.genre, mediaType: metadata.mediaType, status: metadata.status, buyMode: metadata.buyMode,
    currency: metadata.currency, pricingModel: metadata.pricingModel, priceCents: metadata.priceCents,
    suggestedPriceCents: metadata.suggestedPriceCents, minimumPriceCents: metadata.minimumPriceCents,
    saleEnabled: metadata.saleEnabled, salePriceCents: metadata.salePriceCents,
    saleStart: metadata.saleStart || null, saleEnd: metadata.saleEnd || null,
    coverR2Key: mapped.files.product.generated_cover_key || mapped.files.cover.quarantine_key,
    backCoverR2Key: mapped.files.product.generated_back_cover_key || null,
    deliveryR2Key: mapped.files.product.quarantine_key,
    deliveryFilename: mapped.files.product.normalized_filename, deliveryContentType: mapped.files.product.content_type,
    metadata: {
      authors: metadata.authors, authorSlugs: metadata.authorSlugs, format: metadata.format,
      version: metadata.version, creationMethod: metadata.creationMethod,
      ...(mapped.files.product.pdf_page_count ? { pageCount: Number(mapped.files.product.pdf_page_count) } : {}),
      ...(direct ? { creatorPublicationRevision: input.expectedRevision + 1 } : { creatorReviewRevision: input.expectedRevision + 1 }),
      ...Object.fromEntries(DISCOVERY_FIELDS.filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]]))
    }, publishedAt
  };
  const nextRevision = input.expectedRevision + 1;
  const existing = await database.prepare("SELECT * FROM marketplace_products WHERE creator_listing_id=? OR id=?").bind(listing.id, metadata.id).first();
  if (existing) productInput.listingVisibility = input.listingVisibility || existing.listingVisibility || "unlisted";
  if (existing && (existing.id !== metadata.id || existing.slug !== metadata.slug || existing.creator_id !== listing.creator_id || existing.creator_listing_id !== listing.id)) {
    throw new CreatorReviewError("product_conflict", "The existing native product identity does not match this Creator listing.", 409);
  }
  const prepared = existing
    ? await prepareUpdateProduct(database, existing.id, Object.fromEntries(Object.entries(productInput).filter(([key]) => !["id", "slug", "creatorId"].includes(key))), {
        expectedRevision: Number(existing.revision),
        nowMs: input.nowMs,
        creatorTransition: direct ? null : { listingId: listing.id, listingRevision: nextRevision },
      })
    : prepareCreateProduct(database, productInput, { nowMs: input.nowMs });
  const productNextRevision = existing ? prepared.expectedNextRevision : 1;
  const guardedReviewAudit = !direct
    ? (existing ? database.prepare(`INSERT INTO creator_review_audit(listing_id,creator_id,actor_user_id,action,note,created_at)
        VALUES((SELECT creator_listing_id FROM marketplace_products WHERE id=? AND revision=?),?,?,?,?,?)`)
        .bind(existing.id, productNextRevision, listing.creator_id, input.actorId, "approve", input.note, publishedAt)
      : database.prepare("INSERT INTO creator_review_audit(listing_id,creator_id,actor_user_id,action,note,created_at) VALUES(?,?,?,?,?,?)")
        .bind(listing.id, listing.creator_id, input.actorId, "approve", input.note, publishedAt))
    : null;
  const sourceState = direct ? listing.lifecycle_state : "submitted";
  const sourcePublicationState = direct ? listing.publication_state : "not_approved";
  const guardedState = direct
    ? database.prepare(`UPDATE creator_listings SET lifecycle_state='active',publication_state='publishing',updated_at=?,revision=revision+1 WHERE id=? AND lifecycle_state=? AND publication_state=? AND revision=?`).bind(publishedAt, listing.id, sourceState, sourcePublicationState, input.expectedRevision)
    : database.prepare(`UPDATE creator_listings SET publication_state='publishing',updated_at=?,revision=revision+1 WHERE id=? AND lifecycle_state='submitted' AND publication_state='not_approved' AND revision=?`).bind(publishedAt, listing.id, input.expectedRevision);
  await database.batch([
    guardedState,
    prepared.statement,
    database.prepare(`UPDATE creator_listings SET lifecycle_state='active',publication_state='published',public_product_slug=?,reviewed_at=CASE WHEN ? THEN reviewed_at ELSE ? END,review_note=?,updated_at=?,published_at=?,first_published_at=COALESCE(first_published_at,?),revision=revision+1 WHERE id=? AND lifecycle_state='${direct ? "active" : "submitted"}' AND publication_state='publishing' AND revision=?`)
      .bind(metadata.slug, direct ? 1 : 0, publishedAt, input.note || "", publishedAt, publishedAt, publishedAt, listing.id, nextRevision),
    database.prepare("UPDATE creator_listing_files SET delivery_object_key=? WHERE id=?").bind(mapped.files.product.quarantine_key, mapped.files.product.id),
    ...(guardedReviewAudit ? [guardedReviewAudit] : []),
    audit(database, listing.id, listing.creator_id, input.actorId, direct ? (existing ? "creator_republished" : "creator_published") : (existing ? "republished" : "published"), { note: input.note, productId: prepared.product.id, slug: prepared.product.slug, sourceRevision: input.expectedRevision, publishedRevision: nextRevision + 1, productRevision: productNextRevision }, publishedAt)
  ]);
  const product = await database.prepare("SELECT id,slug,title,publication_state,revision FROM marketplace_products WHERE id=?").bind(prepared.product.id).first();
  const committed = await database.prepare("SELECT publication_state,revision FROM creator_listings WHERE id=?").bind(listing.id).first();
  if (!product || product.publication_state !== "published" || committed?.publication_state !== "published") throw new CreatorReviewError("commit_unverified", "Native Creator publication could not be verified.", 503);
  return { id: product.id, slug: product.slug, title: product.title, revision: product.revision, url: `/store/products/${product.slug}/` };
}

export const publishApprovedCreatorListing = (database, bucket, input) => publishCreatorListing(database, bucket, { ...input, requireSubmitted: true });

async function reviewQueue(database, csrfToken) {
  const result = await database.prepare(`SELECT cl.*,c.display_name creator_name,c.slug creator_slug,
    (SELECT COUNT(*) FROM creator_listing_files f WHERE f.listing_id=cl.id AND f.validation_state='accepted') accepted_files,
    (SELECT COUNT(*) FROM creator_listing_files f WHERE f.listing_id=cl.id AND f.validation_state='rejected') rejected_files
    FROM creator_listings cl JOIN marketplace_creators c ON c.id=cl.creator_id
    WHERE cl.lifecycle_state IN ('submitted','active','needs_changes','rejected') OR cl.publication_state IN ('waiting_for_files','ready','publishing','failed') ORDER BY cl.submitted_at`).all();
  const files = await database.prepare("SELECT id,listing_id,purpose,normalized_filename,content_type,size_bytes,validation_state,validation_message,uploaded_at,validated_at FROM creator_listing_files WHERE validation_state<>'superseded' ORDER BY uploaded_at DESC").all();
  return jsonResponse({ csrfToken, listings: result.results || [], files: files.results || [] });
}
async function verifyAcceptedObject(bucket, file, purpose) {
  const object = await bucket.head(file.quarantine_key), size = Number(object?.size ?? object?.objectSize ?? -1);
  if (!object || size !== Number(file.size_bytes) || object.httpMetadata?.contentType !== file.content_type || object.customMetadata?.listingId !== file.listing_id || object.customMetadata?.purpose !== purpose) throw new CreatorReviewError("asset_verification_failed", `The accepted ${purpose} file could not be verified in private storage.`, 409);
}
async function verifyGeneratedObject(bucket, file, field, purpose) {
  const object = await bucket.head(file[field]);
  if (!object || object.httpMetadata?.contentType !== "image/webp" ||
      object.customMetadata?.listingId !== file.listing_id || object.customMetadata?.purpose !== purpose ||
      object.customMetadata?.uploadAttemptId !== file.id) {
    throw new CreatorReviewError("asset_verification_failed", `The PDF-generated ${purpose} file could not be verified in private storage.`, 409);
  }
}
async function revisionConflict(database, listingId) {
  const listing = await database.prepare("SELECT revision,lifecycle_state,publication_state FROM creator_listings WHERE id=?").bind(listingId).first();
  return failure("revision_conflict", "The listing changed after it was loaded.", 409, { listing: listing || null });
}
function audit(db, listingId, creatorId, actor, action, context, now) {
  return db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'operator',?,?,?,?)").bind(listingId, creatorId, actor, action, JSON.stringify(context), now);
}
function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function failure(code, message, status, details = {}) { return jsonResponse({ error: message, code, ...details }, status); }
