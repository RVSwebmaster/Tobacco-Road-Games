import { getProductBySlug } from "./product-catalog-d1.mjs";
import { isPublicProductAsset } from "./product-asset-policy.mjs";

const DEFAULT_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const ASSET_FIELDS = Object.freeze({
  "cover.webp": "coverR2Key",
  "preview.webp": "previewR2Key"
});

export async function handlePublicProductAssetRequest(context, { headOnly = false } = {}) {
  const slug = normalizeParam(context.params?.slug);
  const assetName = normalizeParam(context.params?.asset);
  if (!validSlug(slug) || !isPublicProductAsset(assetName)) return notFound();

  const database = context.env?.TRG_ORDERS;
  const bucket = context.env?.TRG_PRODUCTS;
  if (!database?.prepare || !bucket?.get || !bucket?.head) return unavailable();

  let product;
  try {
    product = await getProductBySlug(database, slug);
  } catch (error) {
    logFailure("catalog_lookup", slug, assetName, error);
    return unavailable();
  }
  if (!product || product.publicationState !== "published") return notFound();

  const objectKey = product[ASSET_FIELDS[assetName]];
  if (!isApprovedPublicKey(objectKey, product.deliveryR2Key)) return notFound();

  let object;
  try {
    object = headOnly ? await bucket.head(objectKey) : await bucket.get(objectKey);
  } catch (error) {
    logFailure("r2_read", slug, assetName, error);
    return unavailable();
  }
  if (!object || String(object.httpMetadata?.contentType || "").toLowerCase() !== "image/webp") {
    return notFound();
  }

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || DEFAULT_CACHE_CONTROL);
  headers.set("content-type", "image/webp");
  headers.set("x-content-type-options", "nosniff");
  return new Response(headOnly ? null : object.body, { headers });
}

function isApprovedPublicKey(key, deliveryKey) {
  return typeof key === "string" && key.length > 0 && key.toLowerCase().endsWith(".webp") &&
    key !== deliveryKey;
}

function validSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 160;
}

function normalizeParam(value) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function unavailable() {
  return new Response("Product assets are temporarily unavailable", {
    status: 503,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }
  });
}

function logFailure(stage, slug, assetName, error) {
  console.error(JSON.stringify({
    event: "public_product_asset_failed",
    stage,
    slug,
    assetName,
    message: String(error?.message || error)
  }));
}
