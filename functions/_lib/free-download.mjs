import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";
import { readStoreState } from "./store-state.mjs";
import { getFolderForSlug } from "../../shared/product-folder-map.mjs";

const TTL_SECONDS = 5 * 60;
const MINIMUM_SECRET_LENGTH = 32;

export async function handleFreeDownloadRequest(request, env = {}, options = {}) {
  const storeState = await readStoreState(env, { database: options.database });
  if (!storeState.available || storeState.state !== "OPEN") return unavailable(storeState.state);
  if (!options.allowLegacyAnonymousAcquisition) return errorResponse("verified_checkout_required", 403);
  const product = getFreeDeliveryProduct(new URL(request.url).searchParams.get("product"));
  if (!product) return errorResponse("free_product_not_found", 404);
  if (!env.TRG_PRODUCTS?.head) return errorResponse("free_download_unavailable", 503);
  let object;
  try { object = await env.TRG_PRODUCTS.head(product.r2ObjectKey); } catch { return errorResponse("free_download_unavailable", 503); }
  if (!object) return errorResponse("free_download_unavailable", 503);
  let credential;
  try { credential = await createFreeDownloadCredential(product.productSlug, env.DOWNLOAD_SIGNING_SECRET, options); }
  catch { return errorResponse("free_download_unavailable", 503); }
  const location = new URL(`/store/free-download-file?credential=${encodeURIComponent(credential)}`, request.url);
  return new Response(null, { headers: { "cache-control": "private, no-store", location: location.toString() }, status: 303 });
}

export async function handleFreeDownloadFileRequest(request, env = {}, options = {}) {
  const storeState = await readStoreState(env, { database: options.database });
  if (!storeState.available || storeState.state !== "OPEN") return unavailable(storeState.state);
  let authorization;
  try { authorization = await verifyFreeDownloadCredential(new URL(request.url).searchParams.get("credential"), env.DOWNLOAD_SIGNING_SECRET, options); }
  catch (error) { return errorResponse(error?.code === "credential_expired" ? "free_download_expired" : "free_download_not_authorized", error?.code === "credential_expired" ? 410 : 403); }
  const product = getFreeDeliveryProduct(authorization.productSlug);
  if (!product || !env.TRG_PRODUCTS?.get) return errorResponse("free_download_not_authorized", 403);
  let object;
  try { object = await env.TRG_PRODUCTS.get(product.r2ObjectKey); } catch { return errorResponse("free_download_unavailable", 503); }
  if (!object) return errorResponse("free_download_unavailable", 503);
  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${product.customerFilename}"; filename*=UTF-8''${encodeURIComponent(product.customerFilename)}`,
    "content-type": "application/pdf",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (Number.isInteger(Number(object.size)) && Number(object.size) >= 0) headers.set("content-length", String(object.size));
  return new Response(object.body, { headers, status: 200 });
}

export function getFreeDeliveryProduct(slug) {
  const product = getRuntimeCatalogProduct(slug);
  if (!product || product.status !== "available-direct" || product.listedPriceCents !== 0 || product.fulfillmentEligible !== true) return null;
  const folder = getFolderForSlug(product.slug);
  if (!folder) return null;
  return { customerFilename: `${safeFilename(product.title)}.pdf`, productSlug: product.slug, r2ObjectKey: `${folder}/product.pdf` };
}

async function createFreeDownloadCredential(productSlug, secret, options = {}) {
  assertSecret(secret);
  const issuedAt = nowSeconds(options.nowMs);
  const payload = { expiresAt: issuedAt + (options.ttlSeconds || TTL_SECONDS), issuedAt, productSlug, version: 1 };
  const encoded = encode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${encode(await hmac(encoded, secret, "sign"))}`;
}

async function verifyFreeDownloadCredential(value, secret, options = {}) {
  assertSecret(secret);
  const [encoded, signature, extra] = String(value || "").split(".");
  if (!encoded || !signature || extra) throw authError("credential_malformed");
  const valid = await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), decode(signature), new TextEncoder().encode(encoded));
  if (!valid) throw authError("credential_altered");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(decode(encoded))); } catch { throw authError("credential_malformed"); }
  if (payload?.version !== 1 || typeof payload.productSlug !== "string" || !Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt)) throw authError("credential_malformed");
  const now = nowSeconds(options.nowMs);
  if (payload.issuedAt > now + 60) throw authError("credential_not_yet_valid");
  if (payload.expiresAt <= now) throw authError("credential_expired");
  return payload;
}

function assertSecret(secret) { if (String(secret || "").length < MINIMUM_SECRET_LENGTH) throw authError("signing_secret_unavailable"); }
function authError(code) { const error = new Error("Free download authorization failed."); error.code = code; return error; }
function nowSeconds(nowMs) { return Math.floor((Number.isFinite(nowMs) ? Number(nowMs) : Date.now()) / 1000); }
function key(secret, usages) { return crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { hash: "SHA-256", name: "HMAC" }, false, usages); }
async function hmac(value, secret) { return new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), new TextEncoder().encode(value))); }
function encode(bytes) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function decode(value) { const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/"); const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function safeFilename(value) { return String(value || "download").replace(/[^A-Za-z0-9 ._-]+/g, "").trim() || "download"; }
function unavailable(state) { return errorResponse("store_not_open", 503, { storeState: state }); }
function errorResponse(error, status, extra = {}) { return new Response(JSON.stringify({ error, ...extra }), { headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" }, status }); }
