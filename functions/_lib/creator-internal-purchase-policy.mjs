import { getCreatorTier } from "./marketplace-policy.mjs";

export const OWNER_CREATOR_ID = "creator-rv-sawyer";

export async function getCreatorInternalPurchasePrivilege(
  db,
  { creatorId, userId, nowMs = Date.now() } = {},
) {
  const tier = await getCreatorTier(db, creatorId, nowMs);
  if (tier.preferred)
    return { allowed: true, preferred: true, ownerException: false };
  if (String(creatorId) !== OWNER_CREATOR_ID)
    return { allowed: false, preferred: false, ownerException: false };
  const owner = await db
    .prepare(
      "SELECT 1 ok FROM users u JOIN creator_identity_ownership o ON o.owner_user_id=u.id WHERE u.id=? AND u.status='active' AND u.role IN ('owner','admin') AND o.creator_id=? AND o.identity_type='primary' AND o.account_status='active'",
    )
    .bind(userId, OWNER_CREATOR_ID)
    .first();
  return {
    allowed: Boolean(owner),
    preferred: false,
    ownerException: Boolean(owner),
  };
}

export async function assertCreatorInternalPurchasePrivilege(db, options) {
  const privilege = await getCreatorInternalPurchasePrivilege(db, options);
  if (!privilege.allowed)
    throw new Error(
      "An active Preferred Creator account is required to spend Creator Balance internally.",
    );
  return privilege;
}

export async function assertPreferredRenewalPrivilege(
  db,
  { creatorId, nowMs = Date.now() } = {},
) {
  const tier = await getCreatorTier(db, creatorId, nowMs);
  if (!tier.preferred)
    throw new Error(
      "Initial Preferred activation requires external payment. Creator Balance is available only for an active Preferred renewal.",
    );
  return tier;
}

export function assertDigitalCreatorProduct(product, deliveryMapping) {
  const fulfillmentMode = String(
    product?.fulfillmentMode || product?.fulfillmentType || "internal",
  ).toLowerCase();
  const outsideValue =
    product?.outsideVendor === true ||
    product?.externalVendor === true ||
    product?.externallyFulfilled === true ||
    product?.externalFulfillment === true ||
    Boolean(product?.vendorId) ||
    ["external", "outside_vendor", "vendor", "physical", "hybrid"].includes(
      fulfillmentMode,
    );
  if (
    !product?.creatorId ||
    String(product.mediaType || "").toLowerCase() !== "digital" ||
    product.fulfillmentEligible !== true ||
    outsideValue ||
    !deliveryMapping?.r2ObjectKey ||
    !deliveryMapping?.customerFilename ||
    !deliveryMapping?.contentType
  )
    throw new Error(
      "Creator Balance is limited to internally fulfilled digital Creator products.",
    );
}
