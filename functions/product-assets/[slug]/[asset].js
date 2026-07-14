import { getFolderForSlug } from "../../../shared/product-folder-map.mjs";
import { isPublicProductAsset } from "../../_lib/product-asset-policy.mjs";

const R2_PRODUCT_BUCKET_BINDING = "TRG_PRODUCTS";
const DEFAULT_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export const onRequestGet = (context) => serveProductAsset(context, false);
export const onRequestHead = (context) => serveProductAsset(context, true);

async function serveProductAsset(context, headOnly) {
  const slug = normalizeParam(context.params.slug);
  const assetName = normalizeParam(context.params.asset);
  const objectKey = buildObjectKey(slug, assetName);
  if (!objectKey) {
    return notFound();
  }

  const bucket = context.env?.[R2_PRODUCT_BUCKET_BINDING];
  if (!bucket) {
    return new Response("R2 binding missing: TRG_PRODUCTS", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  const object = await bucket.get(objectKey);
  if (!object) {
    return notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || DEFAULT_CACHE_CONTROL);
  headers.set("content-type", headers.get("content-type") || contentTypeFor(assetName));
  headers.set("x-content-type-options", "nosniff");

  return new Response(headOnly ? null : object.body, {
    headers
  });
}

function normalizeParam(value) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return typeof value === "string" ? value : "";
}

function buildObjectKey(slug, assetName) {
  if (!isPublicProductAsset(assetName)) {
    return "";
  }

  const folder = getFolderForSlug(slug);
  if (!folder) {
    return "";
  }

  return `${folder}/${assetName}`;
}

function contentTypeFor(assetName) {
  if (assetName.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
