import { getSessionFromRequest } from "./account-auth.mjs";
import {
  isDownloadSigningSecretConfigured,
  verifyDownloadCredential
} from "./download-authorization.mjs";
import {
  getNativeEntitlementByDownloadReference,
  isNativeEntitlementOwnedBySession
} from "./native-entitlements-d1.mjs";

export async function handleAccountLibraryCoverRequest(request, env = {}, options = {}) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) return response("Use GET or HEAD.", 405);
  if (!env.TRG_ORDERS?.prepare || !env.TRG_PRODUCTS?.get || !env.TRG_PRODUCTS?.head) {
    return response("Library cover is temporarily unavailable.", 503);
  }
  const secret = String(options.downloadSigningSecret || env.DOWNLOAD_SIGNING_SECRET || "");
  if (!isDownloadSigningSecretConfigured(secret)) return response("Library cover is temporarily unavailable.", 503);
  const credential = new URL(request.url).searchParams.get("credential") || "";
  let authorization;
  try {
    authorization = await verifyDownloadCredential(credential, secret, { nowMs: options.nowMs });
  } catch {
    return response("Library cover is not authorized.", 403);
  }
  if (authorization.version !== 2 || authorization.entitlementKind !== "native_d1") {
    return response("Library cover is not authorized.", 403);
  }
  const [session, entitlement] = await Promise.all([
    options.accountSession === undefined
      ? getSessionFromRequest(request, env, options.accountSessionOptions || {})
      : options.accountSession,
    getNativeEntitlementByDownloadReference(env.TRG_ORDERS, authorization.entitlementReference)
  ]);
  if (!isNativeEntitlementOwnedBySession(entitlement, session)) {
    return response("Library cover is not authorized.", 403);
  }
  const key = String(entitlement.current_cover_r2_key || "");
  if (!isValidCoverKey(key, entitlement.delivery_r2_key_snapshot)) return response("Library cover not found.", 404);
  let object;
  try {
    object = request.method === "HEAD" ? await env.TRG_PRODUCTS.head(key) : await env.TRG_PRODUCTS.get(key);
  } catch {
    return response("Library cover is temporarily unavailable.", 503);
  }
  if (!object || String(object.httpMetadata?.contentType || "").toLowerCase() !== "image/webp") {
    return response("Library cover not found.", 404);
  }
  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-type": "image/webp",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  if (Number.isInteger(Number(object.size)) && Number(object.size) >= 0) {
    headers.set("content-length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

function isValidCoverKey(key, deliveryKey) {
  return key.startsWith("catalog-publications/")
    && key.endsWith("/cover.webp")
    && !key.includes("\\")
    && !key.split("/").includes("..")
    && key !== deliveryKey;
}

function response(message, status) {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
