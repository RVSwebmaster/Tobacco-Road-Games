import { getProductBySlug } from "./product-catalog-d1.mjs";

const AGENCY_ID = "legacy:agency";
const AGENCY_SLUG = "agency";
const AGENCY_CREATOR_ID = "creator-rv-sawyer";
const AGENCY_DELIVERY = Object.freeze({
  contentType: "application/pdf",
  customerFilename: "Agency.pdf",
  objectSizeBytes: 9630946,
  productSlug: AGENCY_SLUG,
  r2ObjectKey: "agency/product.pdf"
});

export async function getLegacyContinuityDelivery(database, productSlug, entitlement) {
  if (String(productSlug || "").toLowerCase() !== AGENCY_SLUG) return null;
  const product = await getProductBySlug(database, AGENCY_SLUG);
  if (!isAgencyContinuityProduct(product) || !isAgencyEntitlementSnapshot(entitlement)) return null;
  return AGENCY_DELIVERY;
}

export function isAgencyContinuityProduct(product) {
  const marker = product?.metadata?.operationSeverance;
  return product?.id === AGENCY_ID
    && product.slug === AGENCY_SLUG
    && product.creatorId === AGENCY_CREATOR_ID
    && product.creatorListingId === null
    && product.publicationState === "retired"
    && product.status === "legacy-not-for-sale"
    && product.buyMode === "retired"
    && product.deliveryR2Key === null
    && marker?.migration === "2R-B"
    && marker?.continuityIdentity === AGENCY_SLUG;
}

export function isAgencyEntitlementSnapshot(entitlement) {
  return entitlement?.product_slug === AGENCY_SLUG
    && entitlement.r2_object_key === AGENCY_DELIVERY.r2ObjectKey
    && entitlement.customer_filename === AGENCY_DELIVERY.customerFilename
    && String(entitlement.content_type || "").toLowerCase() === AGENCY_DELIVERY.contentType
    && Number(entitlement.object_size_bytes) === AGENCY_DELIVERY.objectSizeBytes;
}

export function isAgencyContinuitySlug(productSlug) {
  return String(productSlug || "").toLowerCase() === AGENCY_SLUG;
}
