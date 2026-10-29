import { getProductBySlug } from "./product-catalog-d1.mjs";
import {
  getRuntimeCatalogMap,
  getRuntimeCatalogProducts,
  normalizeSlug
} from "./runtime-catalog.mjs";

export async function resolveHybridCartCatalog(database, requestedSlugs, options = {}) {
  const legacyProducts = Array.isArray(options.catalogProducts) ? options.catalogProducts : getRuntimeCatalogProducts();
  const legacyMap = options.catalogMap instanceof Map
    ? new Map(options.catalogMap)
    : Array.isArray(options.catalogProducts)
      ? new Map(legacyProducts.map(product => [normalizeSlug(product.slug), product]))
      : new Map(getRuntimeCatalogMap());
  const allowedLegacySlug = normalizeSlug(options.allowedProductSlug);
  const catalogMap = allowedLegacySlug
    ? new Map(legacyMap.has(allowedLegacySlug) ? [[allowedLegacySlug, legacyMap.get(allowedLegacySlug)]] : [])
    : legacyMap;
  const sources = new Map([...catalogMap.keys()].map(slug => [slug, "legacy"]));
  const injectedLegacyCatalog = Array.isArray(options.catalogProducts) || options.catalogMap instanceof Map;
  const includeNative = options.includeNative === true || (!injectedLegacyCatalog && options.includeNative !== false);

  if (!includeNative || !database?.prepare) return { catalogMap, sources };

  for (const rawSlug of requestedSlugs || []) {
    const slug = normalizeSlug(rawSlug);
    if (!slug) continue;
    const product = await getProductBySlug(database, slug);
    if (!product) continue;
    const nativeProduct = await toNativeCartProduct(database, product);
    // A D1 identity always wins, including when it is draft, paused, or otherwise
    // unavailable. This prevents a conflicting legacy price from being used.
    catalogMap.set(slug, nativeProduct);
    sources.set(slug, "native-d1");
  }

  return { catalogMap, sources };
}

export async function toNativeCartProduct(database, product) {
  const creator = await database.prepare(`SELECT id,slug,display_name,marketplace_status,
      registration_status,closure_state FROM marketplace_creators WHERE id=?`)
    .bind(product.creatorId).first();
  let listing = null;
  if (product.creatorListingId) {
    listing = await database.prepare(`SELECT lifecycle_state,publication_state,owner_review_hold,
        inactivity_state FROM creator_listings WHERE id=?`)
      .bind(product.creatorListingId).first();
  }
  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  const creatorEligible = Boolean(creator
    && creator.marketplace_status === "approved"
    && creator.registration_status === "active"
    && creator.closure_state === "active");
  const listingEligible = !listing || (listing.lifecycle_state === "active"
    && listing.publication_state === "published"
    && Number(listing.owner_review_hold) !== 1
    && listing.inactivity_state !== "inactive");
  const nativeAvailabilityCode = product.publicationState !== "published"
    ? (product.publicationState === "paused" ? "paused_product" : "unpublished_product")
    : !creatorEligible
      ? "ineligible_creator"
      : !listingEligible
        ? "inactive_product"
        : "";
  const authorSlugs = stringList(metadata.authorSlugs);
  const authors = stringList(metadata.authors);

  return {
    authorDisplay: String(creator?.display_name || authors[0] || product.publisher || "").trim(),
    authorSlugs: authorSlugs.length ? authorSlugs : [String(creator?.slug || "").trim()].filter(Boolean),
    buyMode: product.buyMode,
    catalogRevision: product.revision,
    catalogSource: "native-d1",
    coverUrl: product.coverR2Key ? `/product-assets/${encodeURIComponent(product.slug)}/cover.webp` : "",
    currency: product.currency,
    deliveryContentType: product.deliveryContentType,
    deliveryFilename: product.deliveryFilename,
    deliveryR2Key: product.deliveryR2Key,
    lastUpdated: product.updatedAt,
    minimumPriceCents: product.minimumPriceCents,
    nativeAvailabilityCode,
    nativeCreatorId: product.creatorId,
    nativeProductId: product.id,
    priceCents: product.priceCents,
    pricingModel: product.pricingModel,
    publicationState: product.publicationState,
    saleEnabled: product.saleEnabled,
    saleEnd: product.saleEnd,
    salePriceCents: product.salePriceCents,
    saleStart: product.saleStart,
    slug: product.slug,
    status: product.status,
    suggestedPriceCents: product.suggestedPriceCents,
    title: product.title,
    url: `/store/products/${encodeURIComponent(product.slug)}/`,
    version: String(metadata.version || "").trim()
  };
}

function stringList(value) {
  return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
}
