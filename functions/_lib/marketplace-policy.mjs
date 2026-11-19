export const COMMISSION_POLICY_VERSION = "owner-approved-commission-v1";
export const COMMISSION_POLICY = Object.freeze({
  version: COMMISSION_POLICY_VERSION,
  standardCreatorBasisPoints: 9000,
  founding25CreatorBasisPoints: 9500,
  premierCreatorBasisPoints: 9500,
  ownerCreatorBasisPoints: 0,
  adminCreatorBasisPoints: 0,
  effectiveAt: "2026-11-18T00:00:00.000Z",
});

// Keep catalog-allocation limits independent from the new financial policy.
export const MARKETPLACE_POLICY = Object.freeze({
  standardFeeBasisPoints: 1000,
  preferredFeeBasisPoints: 500,
  standardActiveListingCap: 12,
  preferredActiveListingCap: 24,
  founding25ActiveListingCap: 24,
  standardShelfCap: 6,
  preferredShelfCap: 12,
  founding25ShelfCap: 12,
  ownerShelfCap: 14,
  standardPwywCap: 1,
  preferredPwywCap: 2,
});

export async function getCreatorTier(database, creatorId, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  let term = null;
  try {
    term = await database.prepare("SELECT * FROM creator_preferred_terms WHERE creator_id=? AND status='active' AND term_started_at<=? AND term_ends_at>? ORDER BY term_ends_at DESC LIMIT 1").bind(String(creatorId), now, now).first();
    if (term) {
      const serviceState = await database.prepare("SELECT COUNT(*) charge_count,MAX(CASE WHEN p.status='settled' AND pc.coverage_starts_at<=? AND pc.coverage_ends_at>? THEN 1 ELSE 0 END) covered FROM preferred_service_charges pc JOIN marketplace_service_purchases p ON p.id=pc.service_purchase_id WHERE pc.preferred_term_id=?").bind(now, now, term.id).first();
      let commitment = null;
      try { commitment = await database.prepare("SELECT * FROM preferred_billing_commitments WHERE preferred_term_id=?").bind(term.id).first(); } catch {}
      if (commitment && !commitment.paid_through_at) term = null;
      else if (Number(serviceState?.charge_count || 0) > 0 && !Number(serviceState?.covered || 0)) {
        let grace = null;
        try { grace = await database.prepare("SELECT 1 active FROM preferred_billing_installments i JOIN preferred_billing_commitments b ON b.id=i.commitment_id WHERE b.preferred_term_id=? AND b.billing_state='remediation' AND i.status='failed' AND i.due_at<=? AND i.grace_ends_at>? LIMIT 1").bind(term.id, now, now).first(); } catch {}
        if (!grace) term = null;
      }
    }
  } catch {}
  return { preferred: Boolean(term), term: term || null };
}

export async function resolveSalePolicy(database, { creatorId, firstPublishedAt, nowMs = Date.now() } = {}) {
  const now = new Date(nowMs).toISOString();
  if (Number(nowMs) < Date.parse(COMMISSION_POLICY.effectiveAt)) {
    return resolveHistoricalSalePolicy(database, { creatorId, firstPublishedAt, nowMs });
  }
  const identity = await database.prepare(`
    SELECT u.role FROM creator_identity_ownership io
    JOIN users u ON u.id=io.owner_user_id WHERE io.creator_id=?
  `).bind(String(creatorId)).first().catch(() => null);
  const role = String(identity?.role || "").toLowerCase();
  if (role === "owner") return salePolicy("owner", 0, "owner_house_revenue", now);
  if (role === "admin") return salePolicy("admin", 0, "admin_house_revenue", now);

  let founding = null;
  try {
    founding = await database.prepare(`
      SELECT id FROM creator_commission_category_assignments
      WHERE creator_id=? AND category='founding25' AND effective_at<=?
        AND (revoked_at IS NULL OR revoked_at>?)
      ORDER BY effective_at DESC,id DESC LIMIT 1
    `).bind(String(creatorId), now, now).first();
  } catch {}
  if (founding) return salePolicy("founding25", COMMISSION_POLICY.founding25CreatorBasisPoints, "owner_assigned_founding25", now);

  const tier = await getCreatorTier(database, creatorId, nowMs);
  return tier.preferred
    ? salePolicy("premier", COMMISSION_POLICY.premierCreatorBasisPoints, "premier", now)
    : salePolicy("standard", COMMISSION_POLICY.standardCreatorBasisPoints, "standard", now);
}

async function resolveHistoricalSalePolicy(database, { creatorId, firstPublishedAt, nowMs }) {
  const now = Number(nowMs);
  const first = Date.parse(firstPublishedAt || "");
  const launch = Number.isFinite(first) && now >= first && now < first + 30 * 86400000;
  const tier = await getCreatorTier(database, creatorId, nowMs);
  let basisPoints = launch ? 1000 : tier.preferred ? 1000 : 2000;
  let reason = launch ? "launch" : tier.preferred ? "preferred" : "standard";
  try {
    const promo = await database.prepare("SELECT * FROM marketplace_fee_policies WHERE effective_at<=? ORDER BY effective_at DESC,id DESC LIMIT 1").bind(new Date(now).toISOString()).first();
    if (promo && Number(promo.percentage_basis_points) < basisPoints) {
      basisPoints = Number(promo.percentage_basis_points);
      reason = "promotional_override";
    }
  } catch {}
  return {
    category: tier.preferred ? "premier" : "standard",
    policyVersion: "legacy-marketplace-policy",
    basisPoints,
    creatorBasisPoints: 10000 - basisPoints,
    reason,
    effectiveAt: new Date(now).toISOString(),
    preferred: tier.preferred,
    houseRevenue: false,
  };
}

function salePolicy(category, creatorBasisPoints, reason, effectiveAt) {
  return {
    category,
    policyVersion: COMMISSION_POLICY_VERSION,
    creatorBasisPoints,
    basisPoints: 10000 - creatorBasisPoints,
    reason,
    effectiveAt,
    houseRevenue: category === "owner" || category === "admin",
  };
}

export async function assignFounding25CommissionCategory(database, { creatorId, actorUserId, reason, effectiveAt, nowMs = Date.now() } = {}) {
  const creator = String(creatorId || "").trim();
  const actor = String(actorUserId || "").trim();
  const note = String(reason || "").trim().slice(0, 500);
  const starts = new Date(effectiveAt || nowMs);
  if (!creator || !actor || !note || !Number.isFinite(starts.getTime())) throw new Error("Founding-25 commission assignment is invalid.");
  const operator = await database.prepare("SELECT role,status FROM users WHERE id=?").bind(actor).first();
  if (!operator || operator.role !== "owner" || operator.status !== "active") throw new Error("Only an active Owner may assign Founding-25 commission status.");
  const exists = await database.prepare("SELECT 1 found FROM marketplace_creators WHERE id=?").bind(creator).first();
  if (!exists) throw new Error("Creator identity does not exist.");
  const current = await database.prepare("SELECT id FROM creator_commission_category_assignments WHERE creator_id=? AND category='founding25' AND revoked_at IS NULL").bind(creator).first();
  if (current) throw new Error("Creator already has an active Founding-25 commission assignment.");
  const id = crypto.randomUUID();
  const now = new Date(nowMs).toISOString();
  const effective = starts.toISOString();
  await database.batch([
    database.prepare("INSERT INTO creator_commission_category_assignments(id,creator_id,category,effective_at,assigned_by_user_id,reason,created_at) VALUES(?,?,'founding25',?,?,?,?)").bind(id, creator, effective, actor, note, now),
    database.prepare("INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,'operator',?,'founding25_commission_assigned',?,?)").bind(creator, actor, JSON.stringify({ assignmentId: id, effectiveAt: effective, policyVersion: COMMISSION_POLICY_VERSION, reason: note }), now),
  ]);
  return { id, creatorId: creator, category: "founding25", effectiveAt: effective, policyVersion: COMMISSION_POLICY_VERSION };
}

export async function revokeFounding25CommissionCategory(database, { creatorId, actorUserId, reason, nowMs = Date.now() } = {}) {
  const creator = String(creatorId || "").trim();
  const actor = String(actorUserId || "").trim();
  const note = String(reason || "").trim().slice(0, 500);
  if (!creator || !actor || !note) throw new Error("Founding-25 commission revocation is invalid.");
  const operator = await database.prepare("SELECT role,status FROM users WHERE id=?").bind(actor).first();
  if (!operator || operator.role !== "owner" || operator.status !== "active") throw new Error("Only an active Owner may revoke Founding-25 commission status.");
  const now = new Date(nowMs).toISOString();
  const assignment = await database.prepare("SELECT id FROM creator_commission_category_assignments WHERE creator_id=? AND category='founding25' AND revoked_at IS NULL ORDER BY effective_at DESC LIMIT 1").bind(creator).first();
  if (!assignment) throw new Error("No active Founding-25 commission assignment exists.");
  await database.batch([
    database.prepare("UPDATE creator_commission_category_assignments SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now, assignment.id),
    database.prepare("INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,'operator',?,'founding25_commission_revoked',?,?)").bind(creator, actor, JSON.stringify({ assignmentId: assignment.id, policyVersion: COMMISSION_POLICY_VERSION, reason: note }), now),
  ]);
  return { id: assignment.id, creatorId: creator, revokedAt: now };
}

export async function getCreatorCapacity(database, creatorId, nowMs = Date.now()) {
  let creator = {}, identity = null, founding = null;
  try { creator = await database.prepare("SELECT owner_catalog_override FROM marketplace_creators WHERE id=?").bind(String(creatorId)).first() || {}; } catch {}
  try { identity = await database.prepare("SELECT u.role,u.status FROM creator_identity_ownership io JOIN users u ON u.id=io.owner_user_id WHERE io.creator_id=?").bind(String(creatorId)).first(); } catch {}
  const now = new Date(nowMs).toISOString();
  try { founding = await database.prepare("SELECT 1 active FROM creator_commission_category_assignments WHERE creator_id=? AND category='founding25' AND effective_at<=? AND (revoked_at IS NULL OR revoked_at>?) ORDER BY effective_at DESC LIMIT 1").bind(String(creatorId), now, now).first(); } catch {}
  const tier = await getCreatorTier(database, creatorId, nowMs),
    activeOwner = identity?.status === "active" && identity.role === "owner",
    activeAdmin = identity?.status === "active" && identity.role === "admin",
    founding25 = Boolean(founding),
    preferred = Boolean(tier.preferred),
    ownerCatalogOverride = Boolean(creator.owner_catalog_override),
    category = activeAdmin ? "admin" : activeOwner || ownerCatalogOverride ? "owner" : founding25 ? "founding25" : preferred ? "premier" : "standard";
  return {
    activeListingCap: category === "admin" || category === "owner" ? null : category === "founding25" ? MARKETPLACE_POLICY.founding25ActiveListingCap : preferred ? MARKETPLACE_POLICY.preferredActiveListingCap : MARKETPLACE_POLICY.standardActiveListingCap,
    shelfCap: category === "admin" ? null : category === "owner" ? MARKETPLACE_POLICY.ownerShelfCap : category === "founding25" || preferred ? MARKETPLACE_POLICY.founding25ShelfCap : MARKETPLACE_POLICY.standardShelfCap,
    pwywCap: preferred ? MARKETPLACE_POLICY.preferredPwywCap : MARKETPLACE_POLICY.standardPwywCap,
    category, ownerCatalogOverride, preferred, founding25, owner: category === "owner", admin: category === "admin",
  };
}

export async function assertPublicationCapacity(database, listing, nowMs = Date.now()) {
  const limits = await getCreatorCapacity(database, listing.creator_id, nowMs);
  let counts;
  try { counts = await database.prepare("SELECT SUM(CASE WHEN publication_state='published' THEN 1 ELSE 0 END) active_count,SUM(CASE WHEN publication_state='published' AND pricing_model='pwyw' THEN 1 ELSE 0 END) pwyw_count FROM creator_listings WHERE creator_id=? AND id<>?").bind(listing.creator_id, listing.id).first(); }
  catch { return { ...limits, nextActive: 0, nextPwyw: 0, legacySchema: true }; }
  const nextActive = Number(counts?.active_count || 0) + 1;
  const nextPwyw = Number(counts?.pwyw_count || 0) + (listing.pricing_model === "pwyw" ? 1 : 0);
  if (limits.activeListingCap !== null && nextActive > limits.activeListingCap) throw new Error(`Active catalog capacity is ${limits.activeListingCap}. Pause a listing before publishing another.`);
  if (nextPwyw > limits.pwywCap) throw new Error(`Active Pay What You Want capacity is ${limits.pwywCap}. Pause one before publishing another.`);
  return { ...limits, nextActive, nextPwyw };
}

export async function assertShelfCapacity(database, listing, nowMs = Date.now()) {
  const limits = await getCreatorCapacity(database, listing.creator_id, nowMs);
  if (limits.shelfCap === null) return { ...limits, nextShelved: null };
  const row = await database.prepare("SELECT COUNT(*) count FROM marketplace_products WHERE creator_id=? AND publication_state='published' AND storefront_visibility='listed' AND creator_listing_id IS NOT ?").bind(listing.creator_id, listing.id).first();
  const nextShelved = Number(row?.count || 0) + 1;
  if (nextShelved > limits.shelfCap) throw new Error(`Shelved product capacity is ${limits.shelfCap}. Unshelve a product before shelving another.`);
  return { ...limits, nextShelved };
}

export async function createPreferredTerm(database, { creatorId, paymentCadence, termStartedAt, operatorActor, nowMs = Date.now() } = {}) {
  if (!["monthly_commitment", "annual_prepaid"].includes(paymentCadence) || !creatorId || !operatorActor) throw new Error("Preferred term is invalid.");
  const start = new Date(termStartedAt || nowMs);
  if (!Number.isFinite(start.getTime())) throw new Error("Preferred term start is invalid.");
  const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1);
  const id = crypto.randomUUID(), now = new Date(nowMs).toISOString(), price = paymentCadence === "monthly_commitment" ? 2000 : 20000;
  await database.batch([
    database.prepare("INSERT INTO creator_preferred_terms(id,creator_id,payment_cadence,price_cents,term_started_at,term_ends_at,renewal_state,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'renews','active',?,?)").bind(id, String(creatorId), paymentCadence, price, start.toISOString(), end.toISOString(), now, now),
    database.prepare("INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,'operator',?,'preferred_term_created',?,?)").bind(String(creatorId), String(operatorActor), JSON.stringify({ termId: id, termEndsAt: end.toISOString() }), now),
  ]);
  return { id, termEndsAt: end.toISOString(), priceCents: price };
}

export async function cancelPreferredRenewal(database, { termId, operatorActor, nowMs = Date.now() } = {}) {
  const now = new Date(nowMs).toISOString();
  await database.prepare("UPDATE creator_preferred_terms SET renewal_state='cancelled',updated_at=? WHERE id=? AND status='active'").bind(now, String(termId)).run();
  return { id: String(termId), renewalState: "cancelled" };
}

export async function correctFirstPublication(database, { listingId, correctedTimestamp, reason, operatorActor, nowMs = Date.now() } = {}) {
  const listing = await database.prepare("SELECT first_published_at FROM creator_listings WHERE id=?").bind(String(listingId)).first();
  const corrected = new Date(correctedTimestamp), note = String(reason || "").trim();
  if (!listing?.first_published_at || !Number.isFinite(corrected.getTime()) || !note || !operatorActor) throw new Error("First-publication correction is invalid.");
  await database.prepare("INSERT INTO creator_first_publication_corrections(listing_id,previous_timestamp,corrected_timestamp,reason,operator_actor,created_at) VALUES(?,?,?,?,?,?)").bind(String(listingId), listing.first_published_at, corrected.toISOString(), note, String(operatorActor), new Date(nowMs).toISOString()).run();
  return { listingId: String(listingId), correctedTimestamp: corrected.toISOString() };
}
