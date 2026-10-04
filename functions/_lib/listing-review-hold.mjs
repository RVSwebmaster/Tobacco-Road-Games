export async function placeListingReviewHold(
  db,
  { listingId, actorId, reason, correctiveActionExpected = false, nowMs = Date.now() } = {},
) {
  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=?").bind(String(listingId || "")).first();
  if (!listing) throw new Error("Listing not found.");
  const visibleReason = String(reason || "").trim().slice(0, 1000);
  if (!visibleReason) throw new Error("A Creator-visible review-hold reason is required.");
  if (Number(listing.owner_review_hold) === 1) throw new Error("This listing is already on Owner Review Hold.");
  const now = new Date(nowMs).toISOString(), context = {
    reason: visibleReason,
    correctiveActionExpected: correctiveActionExpected === true,
    prior: {
      lifecycleState: listing.lifecycle_state,
      publicationState: listing.publication_state,
      inactivityState: listing.inactivity_state || "active",
    },
  };
  await db.batch([
    db.prepare("UPDATE creator_listings SET owner_review_hold=1,owner_review_hold_reason=?,owner_review_hold_started_at=?,owner_review_hold_corrective_action_expected=?,updated_at=? WHERE id=? AND owner_review_hold=0").bind(visibleReason, now, correctiveActionExpected === true ? 1 : 0, now, listing.id),
    audit(db, listing, actorId, "owner_review_hold_placed", context, now),
  ]);
  return { listingId: listing.id, creatorId: listing.creator_id, onHold: true, reason: visibleReason, startedAt: now, correctiveActionExpected: correctiveActionExpected === true };
}

export async function restoreListingReviewHold(
  db,
  { listingId, actorId, nowMs = Date.now() } = {},
) {
  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=?").bind(String(listingId || "")).first();
  if (!listing) throw new Error("Listing not found.");
  if (Number(listing.owner_review_hold) !== 1) throw new Error("This listing is not on Owner Review Hold.");
  const now = new Date(nowMs).toISOString(), resultingSaleable = listing.lifecycle_state === "active" && listing.publication_state === "published" && (listing.inactivity_state || "active") !== "inactive";
  await db.batch([
    db.prepare("UPDATE creator_listings SET owner_review_hold=0,owner_review_hold_reason='',owner_review_hold_started_at=NULL,owner_review_hold_corrective_action_expected=0,updated_at=? WHERE id=? AND owner_review_hold=1").bind(now, listing.id),
    audit(db, listing, actorId, "owner_review_hold_restored", { priorReason: listing.owner_review_hold_reason, holdStartedAt: listing.owner_review_hold_started_at, lifecycleState: listing.lifecycle_state, publicationState: listing.publication_state, inactivityState: listing.inactivity_state || "active", resultingSaleable }, now),
  ]);
  return { listingId: listing.id, creatorId: listing.creator_id, onHold: false, resultingSaleable };
}

export function assertListingNotOnReviewHold(listing) {
  if (Number(listing?.owner_review_hold) === 1) throw new Error("This listing is on Owner Review Hold and is not available for new acquisition or promotion.");
  return listing;
}

function audit(db, listing, actorId, action, context, now) {
  return db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'operator',?,?,?,?)").bind(listing.id, listing.creator_id, String(actorId || "operator"), action, JSON.stringify(context), now);
}
