export const DEFAULT_PUBLIC_RATING_THRESHOLD = 5;
export const RATING_CATEGORIES = Object.freeze([
  "representation_accuracy",
  "file_quality_completeness",
  "correction_reliability",
  "transaction_experience",
]);

export async function getLaunchEvent(db, { eventId = "official-launch-week" } = {}) {
  const event = await db.prepare("SELECT * FROM marketplace_events WHERE id=?").bind(eventId).first();
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    state: event.lifecycle_state,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    foundingWindowStart: event.founding_window_start,
    foundingWindowEnd: event.founding_window_end,
    content: parseJson(event.content_json, {}),
    public: Number(event.is_public) === 1,
  };
}

export async function previewFoundingCreators(db, { eventId = "official-launch-week" } = {}) {
  const event = await getLaunchEvent(db, { eventId });
  if (!event?.foundingWindowStart || !event?.foundingWindowEnd) return { event, candidates: [], configured: false };
  const result = await db.prepare(`
    SELECT c.id,c.slug,c.display_name,c.registration_completed_at qualifying_timestamp
    FROM marketplace_creators c
    JOIN creator_identity_ownership o ON o.creator_id=c.id
    JOIN users u ON u.id=o.owner_user_id
    WHERE c.registration_completed_at BETWEEN ? AND ?
      AND c.marketplace_status='approved'
      AND COALESCE(c.registration_status,'active')='active'
      AND o.account_status='active'
      AND u.status='active'
      AND u.role NOT IN ('admin','system')
      AND lower(c.slug) NOT LIKE '%test%'
      AND lower(c.slug) NOT LIKE '%staging%'
      AND lower(c.slug) NOT LIKE '%smoke%'
      AND NOT EXISTS (SELECT 1 FROM creator_badge_awards a WHERE a.creator_id=c.id AND a.badge_id='founding-creator' AND a.state='active')
    ORDER BY c.registration_completed_at,c.id
  `).bind(event.foundingWindowStart, event.foundingWindowEnd).all();
  return { event, candidates: result.results || [], configured: true };
}

export async function awardFoundingCreator(db, { creatorId, eventId = "official-launch-week", actorId, nowMs = Date.now() } = {}) {
  if (!actorId) throw new Error("Operator identity is required.");
  const preview = await previewFoundingCreators(db, { eventId });
  const candidate = preview.candidates.find((value) => value.id === creatorId);
  if (!candidate) throw new Error("Creator is not eligible in the configured founding window.");
  const now = new Date(nowMs).toISOString(), id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO creator_badge_awards(id,creator_id,badge_id,source,source_notes,awarded_at,awarded_by,created_at) VALUES(?,?,'founding-creator','founding_window',?,?,?,?)").bind(id, creatorId, `Qualified at ${candidate.qualifying_timestamp} for ${eventId}.`, now, actorId, now),
    db.prepare("INSERT INTO creator_reputation_audit(actor_type,actor_id,action,subject_type,subject_id,context_json,created_at) VALUES('operator',?,'award','founding_reconciliation',?,?,?)").bind(actorId, creatorId, JSON.stringify({ eventId, qualifyingTimestamp: candidate.qualifying_timestamp }), now),
  ]);
  return { awardId: id, creatorId, awardedAt: now };
}

export async function listCreatorBadges(db, creatorId, { nowMs = Date.now(), prominentLimit = 3 } = {}) {
  const now = new Date(nowMs).toISOString();
  const result = await db.prepare(`
    SELECT d.id,d.title,d.short_description,d.category,d.icon_asset_key,d.issuer,d.external_url,d.display_priority,a.awarded_at,a.expires_at
    FROM creator_badge_awards a JOIN creator_badge_definitions d ON d.id=a.badge_id
    WHERE a.creator_id=? AND a.state='active' AND d.active=1 AND (a.expires_at IS NULL OR a.expires_at>?)
    ORDER BY d.display_priority,a.awarded_at,d.title
  `).bind(creatorId, now).all();
  const badges = (result.results || []).map(publicBadge);
  return { prominent: badges.slice(0, prominentLimit), all: badges, overflowCount: Math.max(0, badges.length - prominentLimit), hasFoundingHalo: badges.some((badge) => badge.id === "founding-creator") };
}

export async function manageBadgeAward(db, { action, awardId, creatorId, badgeId, source, sourceNotes = "", awardedAt, expiresAt = null, reason = "", actorId, nowMs = Date.now() } = {}) {
  if (!actorId) throw new Error("Operator identity is required.");
  const now = new Date(nowMs).toISOString();
  if (action === "award") {
    const definition = await db.prepare("SELECT id,active FROM creator_badge_definitions WHERE id=?").bind(badgeId).first();
    if (!definition || Number(definition.active) !== 1 || badgeId === "preferred-creator") throw new Error("An active operator-assignable badge is required.");
    const id = awardId || crypto.randomUUID(), date = awardedAt || now;
    await db.batch([
      db.prepare("INSERT INTO creator_badge_awards(id,creator_id,badge_id,source,source_notes,awarded_at,awarded_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id,badge_id) DO UPDATE SET source=excluded.source,source_notes=excluded.source_notes,awarded_at=excluded.awarded_at,awarded_by=excluded.awarded_by,expires_at=excluded.expires_at,state='active',state_reason='',state_changed_at=excluded.created_at,state_changed_by=excluded.awarded_by").bind(id,creatorId,badgeId,String(source||"operator_verified").slice(0,100),String(sourceNotes).slice(0,2000),date,actorId,expiresAt,now),
      db.prepare("INSERT INTO creator_reputation_audit(actor_type,actor_id,action,subject_type,subject_id,context_json,created_at) VALUES('operator',?,'award','badge_award',?,?,?)").bind(actorId,id,JSON.stringify({creatorId,badgeId,source}),now),
    ]);
    return { awardId:id,state:"active" };
  }
  if (!["revoke","correct","restore"].includes(action)) throw new Error("Badge action is invalid.");
  const state = action === "restore" ? "active" : action === "correct" ? "corrected" : "revoked";
  const result = await db.prepare("UPDATE creator_badge_awards SET state=?,state_reason=?,state_changed_at=?,state_changed_by=? WHERE id=?").bind(state,String(reason).slice(0,500),now,actorId,awardId).run();
  if (!Number(result.meta?.changes || result.changes)) throw new Error("Badge award was not found.");
  await db.prepare("INSERT INTO creator_reputation_audit(actor_type,actor_id,action,subject_type,subject_id,context_json,created_at) VALUES('operator',? ,?,'badge_award',?,?,?)").bind(actorId,action,awardId,JSON.stringify({reason}),now).run();
  return { awardId,state };
}

export async function submitCreatorRating(db, { creatorId, userId, ratingValue, feedback = {}, nowMs = Date.now() } = {}) {
  const value = Number(ratingValue);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("Creator rating must be a whole number from 1 to 5.");
  const normalized = normalizeFeedback(feedback);
  const acquisition = await db.prepare(`
    SELECT o.id order_id FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug
    LEFT JOIN download_entitlements de ON de.order_item_id=oi.id AND de.status='active'
    WHERE o.user_id=? AND cl.creator_id=? AND o.payment_status='paid'
      AND (de.id IS NOT NULL OR cl.media_type IN ('physical','hybrid'))
    ORDER BY o.paid_at DESC,o.id DESC LIMIT 1
  `).bind(userId, creatorId).first();
  if (!acquisition) throw new Error("A verified Tobacco Road Games acquisition from this Creator is required.");
  const existing = await db.prepare("SELECT * FROM creator_reputation_ratings WHERE creator_id=? AND user_id=?").bind(creatorId, userId).first();
  const now = new Date(nowMs).toISOString(), id = existing?.id || crypto.randomUUID();
  if (existing) {
    await db.batch([
      db.prepare("UPDATE creator_reputation_ratings SET acquisition_order_id=?,rating_value=?,feedback_json=?,moderation_state='visible',fraud_state='clear',updated_at=? WHERE id=?").bind(acquisition.order_id, value, JSON.stringify(normalized), now, id),
      history(db, { id, creatorId, userId, action: "updated", prior: existing.rating_value, value, moderation: "visible", fraud: "clear", actorType: "customer", actorId: userId, now }),
    ]);
  } else {
    await db.batch([
      db.prepare("INSERT INTO creator_reputation_ratings(id,creator_id,user_id,acquisition_order_id,rating_value,feedback_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(id, creatorId, userId, acquisition.order_id, value, JSON.stringify(normalized), now, now),
      history(db, { id, creatorId, userId, action: "created", value, moderation: "visible", fraud: "clear", actorType: "customer", actorId: userId, now }),
    ]);
  }
  return { id, creatorId, ratingValue: value, verifiedAcquisition: true, updated: Boolean(existing) };
}

export async function getCreatorRatingSummary(db, creatorId, { threshold = DEFAULT_PUBLIC_RATING_THRESHOLD, includePrivate = false } = {}) {
  const rows = await db.prepare("SELECT rating_value,created_at,updated_at FROM creator_reputation_ratings WHERE creator_id=? AND moderation_state='visible' AND fraud_state='clear'").bind(creatorId).all();
  const values = rows.results || [], count = values.length;
  const distribution = Object.fromEntries([1,2,3,4,5].map((star) => [star, values.filter((row) => Number(row.rating_value) === star).length]));
  const average = count ? values.reduce((sum, row) => sum + Number(row.rating_value), 0) / count : null;
  const publicReady = count >= Math.max(1, Number(threshold) || DEFAULT_PUBLIC_RATING_THRESHOLD);
  const summary = { state: publicReady ? "rated" : count ? "too_few_ratings" : "new_creator", label: publicReady ? `${average.toFixed(1)} · ${count} verified rating${count === 1 ? "" : "s"}` : count ? "Too few ratings" : "New Creator", average: publicReady ? Number(average.toFixed(2)) : null, count: publicReady ? count : 0, verifiedCustomerRatings: true, threshold: Math.max(1, Number(threshold) || DEFAULT_PUBLIC_RATING_THRESHOLD) };
  if (includePrivate) Object.assign(summary, { privateAverage: average === null ? null : Number(average.toFixed(2)), privateCount: count, distribution, recentTrend: calculateTrend(values) });
  return summary;
}

export async function moderateCreatorRating(db, { ratingId, action, reason, actorId, nowMs = Date.now() } = {}) {
  if (!actorId || !["hide_fraud","flag_brigading","flag_abuse","restore"].includes(action)) throw new Error("Valid operator moderation action is required.");
  const current = await db.prepare("SELECT * FROM creator_reputation_ratings WHERE id=?").bind(ratingId).first();
  if (!current) throw new Error("Creator rating was not found.");
  const restore = action === "restore", moderation = restore ? "visible" : action === "hide_fraud" ? "hidden" : "under_review", fraud = restore ? "clear" : action === "hide_fraud" || action === "flag_brigading" ? "suspected" : current.fraud_state, now = new Date(nowMs).toISOString();
  await db.batch([
    db.prepare("UPDATE creator_reputation_ratings SET moderation_state=?,fraud_state=?,updated_at=? WHERE id=?").bind(moderation, fraud, now, ratingId),
    history(db, { id: ratingId, creatorId: current.creator_id, userId: current.user_id, action: restore ? "restored" : "moderated", prior: current.rating_value, value: current.rating_value, moderation, fraud, reason: String(reason || "").slice(0,500), actorType: "operator", actorId, now }),
  ]);
  return { ratingId, moderationState: moderation, fraudState: fraud };
}

function history(db, value) { return db.prepare("INSERT INTO creator_reputation_rating_history(rating_id,creator_id,user_id,action,prior_rating_value,rating_value,moderation_state,fraud_state,reason,actor_type,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(value.id,value.creatorId,value.userId,value.action,value.prior ?? null,value.value,value.moderation,value.fraud,value.reason || "",value.actorType,value.actorId,value.now); }
function normalizeFeedback(input) { const output = {}; for (const key of RATING_CATEGORIES) if (input[key] !== undefined) { const value = Number(input[key]); if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`Feedback category ${key} must be 1 to 5.`); output[key] = value; } return output; }
function publicBadge(row) { return { id: row.id, title: row.title, description: row.short_description, category: row.category, icon: row.icon_asset_key, issuer: row.issuer, externalUrl: row.external_url, awardedAt: row.awarded_at, expiresAt: row.expires_at, accessibleLabel: `${row.title}: ${row.short_description}` }; }
function calculateTrend(rows) { if (rows.length < 2) return "insufficient_data"; const sorted = [...rows].sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at))), split = Math.ceil(sorted.length / 2), recent = sorted.slice(0,split), prior = sorted.slice(split); if (!prior.length) return "insufficient_data"; const avg = (values) => values.reduce((sum,row) => sum + Number(row.rating_value),0) / values.length, delta = avg(recent)-avg(prior); return delta > .25 ? "up" : delta < -.25 ? "down" : "steady"; }
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
