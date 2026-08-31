import { getCreatorOperationalEligibility } from "./creator-registration.mjs";

export function listingCanCharge(listing) {
  return listing.pricing_model === "pwyw"
    ? Number(listing.listed_price_cents || 0) > 0
    : listing.pricing_model !== "free" &&
        Number(listing.listed_price_cents || 0) > 0;
}
export async function assertCreatorPublicationReadiness(database, listing) {
  let declaration;
  try {
    declaration = await database
      .prepare(
        "SELECT 1 ok FROM creator_listing_declarations WHERE listing_id=? ORDER BY declared_at DESC LIMIT 1",
      )
      .bind(listing.id)
      .first();
  } catch (error) {
    if (
      /no such table:\s*creator_listing_declarations/i.test(
        String(error?.message || error),
      )
    )
      return { legacySchema: true };
    throw error;
  }
  if (!declaration)
    throw new Error(
      "Current product rights, representation, and license declarations are required.",
    );
  try {
    const audit = await database
      .prepare(
        "SELECT state FROM creator_account_audit_states WHERE creator_id=?",
      )
      .bind(listing.creator_id)
      .first();
    if (audit?.state === "restricted")
      throw new Error(
        "Creator account audit restriction blocks new publication.",
      );
  } catch (error) {
    if (
      !/no such table:\s*creator_account_audit_states/i.test(
        String(error?.message || error),
      )
    )
      throw error;
  }
  const state = await getCreatorOperationalEligibility(
    database,
    listing.creator_id,
  ),
    missing = [];
  if (!state.eligible)
    missing.push("Current Creator eligibility requirements are not satisfied.");
  if (!state.agreementCurrent)
    missing.push("The current Creator Agreement must be accepted.");
  if (!state.payoutReady)
    missing.push("Stripe Connect payout setup is incomplete.");
  if (!state.paymentMethodReady)
    missing.push("A valid creator payment method is required.");
  if (!state.identityEntitled)
    missing.push("Creator identity billing or entitlement is inactive.");
  if (missing.length) throw new Error(missing.join(" "));
  return { ...state, freeOnly: !listingCanCharge(listing) };
}
export async function recordListingDeclaration(
  database,
  {
    listingId,
    creatorId,
    userId,
    rightsConfirmed,
    representationConfirmed,
    licensesConfirmed,
    nowMs = Date.now(),
  } = {},
) {
  if (
    rightsConfirmed !== true ||
    representationConfirmed !== true ||
    licensesConfirmed !== true
  )
    throw new Error("All product declarations are required.");
  const now = new Date(nowMs).toISOString(),
    key = `${now}:${crypto.randomUUID()}`;
  await database
    .prepare(
      "INSERT INTO creator_listing_declarations(listing_id,creator_id,declared_by_user_id,submission_key,rights_confirmed,representation_confirmed,licenses_confirmed,declared_at) VALUES(?,?,?,?,1,1,1,?)",
    )
    .bind(listingId, creatorId, userId, key, now)
    .run();
  return { submissionKey: key, declaredAt: now };
}
