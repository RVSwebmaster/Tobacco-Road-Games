import { getProductBySlug, listProducts, ProductCatalogError } from "./product-catalog-d1.mjs";
import { jsonResponse } from "./owner-runtime.mjs";

const PUBLIC_METADATA = [
  "authors", "authorSlugs", "format", "tags", "features", "version", "pageCount",
  "releaseDate", "language", "contentDescriptors", "openRulesEligible", "featured"
];

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
      return jsonResponse({ product: publicProduct(product) });
    }
    const limit = numberParam(params.get("limit"), 50, 1, 100);
    const offset = numberParam(params.get("offset"), 0, 0, 100_000);
    const creatorId = params.get("creatorId") || undefined;
    const status = params.get("status") || undefined;
    if (creatorId?.length > 160 || status?.length > 80) return jsonResponse({ error: "Catalog filter is invalid." }, 400);
    const products = await listProducts(env.TRG_ORDERS, {
      creatorId, status, publicationState: "published", limit, offset
    });
    return jsonResponse({ products: products.map(publicProduct), limit, offset });
  } catch (error) {
    if (error instanceof ProductCatalogError && error.code === "invalid_input") {
      return jsonResponse({ error: error.message }, 400);
    }
    console.error(JSON.stringify({ event: "public_catalog_read_failed", message: String(error?.message || error) }));
    return jsonResponse({ error: "Catalog could not be read." }, 503);
  }
}

export function publicProduct(product) {
  const metadata = {};
  for (const key of PUBLIC_METADATA) {
    if (Object.hasOwn(product.metadata, key)) metadata[key] = product.metadata[key];
  }
  return {
    id: product.id,
    slug: product.slug,
    creatorId: product.creatorId,
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
    hasPreview: Boolean(product.previewR2Key),
    metadata,
    publishedAt: product.publishedAt,
    updatedAt: product.updatedAt
  };
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
