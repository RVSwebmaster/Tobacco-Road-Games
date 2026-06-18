const PUBLIC_PRODUCT_ASSET_FOLDERS = {
  "tablecraft-primer": "Trablecraft Primer",
  "circle-of-cinder": "circleofcinder",
  "final-flame": "finalflame",
  "mouthy-monsters": "mouthy-monsters",
  "path-of-the-janky": "path of the janky",
  ringbound: "ringbound",
  sirrocans: "sirrocans",
  spriggans: "spriggans",
  yojimbo: "yojimbo"
};

const PUBLIC_ASSET_FILES = new Set(["cover.webp", "preview.webp"]);
const R2_PRODUCT_BUCKET_BINDING = "TRG_PRODUCTS";
const DEFAULT_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export const onRequestGet = (context) => serveProductAsset(context, false);
export const onRequestHead = (context) => serveProductAsset(context, true);

async function serveProductAsset(context, headOnly) {
  const staticResponse = await context.next();
  if (staticResponse.status !== 404) {
    return staticResponse;
  }

  const slug = normalizeParam(context.params.slug);
  const assetName = normalizeParam(context.params.asset);
  const objectKey = buildObjectKey(slug, assetName);
  if (!objectKey) {
    return staticResponse;
  }

  const bucket = context.env?.[R2_PRODUCT_BUCKET_BINDING];
  if (!bucket) {
    return staticResponse;
  }

  const object = await bucket.get(objectKey);
  if (!object) {
    return staticResponse;
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
  if (!PUBLIC_ASSET_FILES.has(assetName)) {
    return "";
  }

  const folder = PUBLIC_PRODUCT_ASSET_FOLDERS[slug];
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
