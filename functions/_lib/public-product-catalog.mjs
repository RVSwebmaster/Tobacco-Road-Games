import { getProductById, getProductBySlug, listProducts, ProductCatalogError } from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const PUBLIC_METADATA = [
  "authors", "authorSlugs", "format", "tags", "features", "version", "pageCount",
  "releaseDate", "language", "contentDescriptors", "openRulesEligible", "featured",
  "series", "seriesSlug", "volume", "playerCountMin", "playerCountMax", "gmMode", "prepBurden",
  "playMode", "rulesComplexity"
];

const LISTED_STATUSES = new Set([
  "available-direct", "coming-soon", "free-download", "legacy-edition",
  "pay-what-you-want", "preview-available", "revised-edition-pending"
]);
const PURCHASE_BUY_MODES = new Set(["cart", "free-download"]);
// The current catalog has no separate Shelved state. These are the statuses
// eligible for a live storefront shelf; drafts and catalog-only previews stay out.
const SHELVED_STATUSES = ["available-direct", "pay-what-you-want", "free-download"];
const EXISTING_CREATOR_PROFILES = new Map([
  ["rv-sawyer", "/authors/rv-sawyer/"]
]);

export async function handlePublicCatalogRequest(request, env) {
  if (request.method !== "GET") return jsonResponse({ error: "Use GET for the catalog." }, 405);
  if (!env.TRG_ORDERS?.prepare) return jsonResponse({ error: "Catalog database is unavailable." }, 503);
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug");
  if (slug !== null && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) || slug.length > 160)) {
    return jsonResponse({ error: "Product slug is invalid." }, 400);
  }
  try {
    if (slug !== null) {
      const product = await getProductBySlug(env.TRG_ORDERS, slug);
      if (!product || product.publicationState !== "published") {
        return jsonResponse({ error: "Product not found." }, 404);
      }
      const creator = await getApprovedCreator(env.TRG_ORDERS, product.creatorId);
      if (!creator) return jsonResponse({ error: "Product not found." }, 404);
      return jsonResponse({ product: publicProduct(product, creator) });
    }
    const limit = numberParam(params.get("limit"), 50, 1, 100);
    const offset = numberParam(params.get("offset"), 0, 0, 100_000);
    const creatorId = params.get("creatorId") || undefined;
    const status = params.get("status") || undefined;
    if (creatorId?.length > 160 || status?.length > 80) return jsonResponse({ error: "Catalog filter is invalid." }, 400);
    const products = await listProducts(env.TRG_ORDERS, {
      creatorId, status, publicationState: "published", limit, offset
    });
    const publicProducts = [];
    const creators = new Map();
    for (const product of products) {
      if (!creators.has(product.creatorId)) {
        creators.set(product.creatorId, await getApprovedCreator(env.TRG_ORDERS, product.creatorId));
      }
      const creator = creators.get(product.creatorId);
      if (creator) publicProducts.push(publicProduct(product, creator));
    }
    return jsonResponse({ products: publicProducts, scannedCount: products.length, limit, offset });
  } catch (error) {
    if (error instanceof ProductCatalogError && error.code === "invalid_input") {
      return jsonResponse({ error: error.message }, 400);
    }
    console.error(JSON.stringify({ event: "public_catalog_read_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "Catalog could not be read." }, 503);
  }
}

export async function getApprovedPublicProductBySlug(database, slug) {
  const product = await getProductBySlug(database, slug);
  if (!product || product.publicationState !== "published") return null;
  const creator = await getApprovedCreator(database, product.creatorId);
  return creator ? publicProduct(product, creator) : null;
}

export async function getApprovedPublicProductById(database, id) {
  const product = await getProductById(database, id);
  if (!product || product.publicationState !== "published") return null;
  const creator = await getApprovedCreator(database, product.creatorId);
  return creator ? publicProduct(product, creator) : null;
}

export async function getOtherApprovedPublicProductsByCreator(database, creatorId, currentSlug) {
  const creator = await getApprovedCreator(database, creatorId);
  if (!creator) return [];
  const result = await database.prepare(`SELECT slug,title FROM marketplace_products
    WHERE creator_id=? AND publication_state='published'
      AND status IN (${SHELVED_STATUSES.map(() => "?").join(",")})
      AND buy_mode<>'retired' AND slug<>?
    ORDER BY slug LIMIT 4`)
    .bind(creatorId, ...SHELVED_STATUSES, currentSlug).all();
  return (result.results || []).map(product => ({
    title: product.title,
    detailUrl: `/store/products/${encodeURIComponent(product.slug)}/`
  }));
}

export function publicProduct(product, creator = {}) {
  const metadata = {};
  for (const key of PUBLIC_METADATA) {
    if (Object.hasOwn(product.metadata, key)) metadata[key] = product.metadata[key];
  }
  return {
    id: product.id,
    slug: product.slug,
    creatorId: product.creatorId,
    creatorName: String(creator.display_name || creator.displayName || product.publisher || "Tobacco Road Games"),
    creatorSlug: String(creator.slug || ""),
    creatorProfileUrl: EXISTING_CREATOR_PROFILES.get(String(creator.slug || "")) || "",
    creatorLogo: String(creator.logo || ""),
    creatorProfileImage: String(creator.profile_image || ""),
    creatorShortBio: String(creator.short_bio || ""),
    title: product.title,
    subtitle: product.subtitle,
    shortDescription: product.shortDescription,
    longDescription: product.longDescription,
    publisher: product.publisher,
    gameSystem: product.gameSystem,
    productLine: product.productLine,
    genre: product.genre,
    mediaType: product.mediaType,
    status: product.status,
    buyMode: product.buyMode,
    buyUrl: product.buyUrl,
    currency: product.currency,
    pricingModel: product.pricingModel,
    priceCents: product.priceCents,
    suggestedPriceCents: product.suggestedPriceCents,
    minimumPriceCents: product.minimumPriceCents,
    saleEnabled: product.saleEnabled,
    salePriceCents: product.salePriceCents,
    saleStart: product.saleStart,
    saleEnd: product.saleEnd,
    hasCover: Boolean(product.coverR2Key),
    hasBackCover: Boolean(product.backCoverR2Key),
    hasPreview: Boolean(product.previewR2Key),
    coverUrl: product.coverR2Key ? `/product-assets/${encodeURIComponent(product.slug)}/cover.webp` : "",
    backCoverUrl: product.backCoverR2Key ? `/product-assets/${encodeURIComponent(product.slug)}/back-cover.webp` : "",
    previewUrl: product.previewR2Key ? `/product-assets/${encodeURIComponent(product.slug)}/preview.webp` : "",
    detailUrl: `/store/products/${encodeURIComponent(product.slug)}/`,
    storefrontVisibility: LISTED_STATUSES.has(product.status) ? "listed" : "unlisted",
    purchaseAvailability: LISTED_STATUSES.has(product.status) && PURCHASE_BUY_MODES.has(product.buyMode)
      ? "cart-quote-only"
      : "unavailable",
    metadata,
    publishedAt: product.publishedAt,
    updatedAt: product.updatedAt
  };
}

async function getApprovedCreator(database, creatorId) {
  return database.prepare(`SELECT id,slug,display_name,logo,profile_image,short_bio FROM marketplace_creators
    WHERE id=? AND marketplace_status='approved' AND registration_status='active' AND closure_state='active'`)
    .bind(creatorId).first();
}

function numberParam(value, fallback, min, max) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new ProductCatalogError("invalid_input", "Catalog pagination is invalid.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ProductCatalogError("invalid_input", "Catalog pagination is invalid.");
  }
  return number;
}
