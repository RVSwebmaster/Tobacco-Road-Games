import { DownloadAuthorizationError, verifyDownloadCredential } from "./download-authorization.mjs";
import {
  getEntitlementById,
  markFulfillmentFailure,
  recordSuccessfulDownload
} from "./order-fulfillment.mjs";
import { getDeliveryProduct, isExactDeliveryMapping } from "./product-delivery.mjs";
import {
  getLegacyContinuityDelivery,
  isAgencyContinuitySlug
} from "./legacy-product-continuity.mjs";
import { getSessionFromRequest } from "./account-auth.mjs";
import {
  getNativeEntitlementByDownloadReference,
  isNativeEntitlementOwnedBySession,
  markNativeDeliveryFailure,
  recordNativeSuccessfulDownload
} from "./native-entitlements-d1.mjs";

export async function handleAuthorizedDownload(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS || !env.TRG_PRODUCTS) {
    return errorResponse("download_unavailable", 503);
  }
  const secret = String(env.DOWNLOAD_SIGNING_SECRET || "");
  const credential = new URL(request.url).searchParams.get("credential") || "";
  let authorization;
  try {
    authorization = await verifyDownloadCredential(credential, secret, { nowMs: options.nowMs });
  } catch (error) {
    const status = error instanceof DownloadAuthorizationError && error.code === "credential_expired" ? 410 : 403;
    return errorResponse("download_not_authorized", status);
  }

  if (authorization.version === 2 && authorization.entitlementKind === "native_d1") {
    return handleNativeAuthorizedDownload(request, env, authorization, options);
  }

  const entitlement = await getEntitlementById(env.TRG_ORDERS, authorization.entitlementId);
  const continuityProduct = await getLegacyContinuityDelivery(
    env.TRG_ORDERS,
    authorization.productSlug,
    entitlement
  );
  // Agency is cut over exclusively to its retired D1 identity and immutable
  // entitlement snapshot. Never fall back to a generated catalog mapping.
  const product = continuityProduct || (
    isAgencyContinuitySlug(authorization.productSlug)
      ? null
      : options.deliveryProducts?.[authorization.productSlug]
        || getDeliveryProduct(authorization.productSlug)
  );
  const authorized = Boolean(
    entitlement
      && entitlement.status === "active"
      && entitlement.order_payment_status === "paid"
      && Number(entitlement.order_id) === Number(authorization.orderId)
      && Number(entitlement.order_item_id) === Number(authorization.orderItemId)
      && entitlement.product_slug === authorization.productSlug
      && isExactDeliveryMapping(entitlement, product)
  );
  if (!authorized) {
    return errorResponse("download_not_authorized", 403);
  }

  let object;
  try {
    object = await env.TRG_PRODUCTS.get(product.r2ObjectKey);
  } catch {
    return errorResponse("download_temporarily_unavailable", 503);
  }
  if (!object) {
    await markFulfillmentFailure(env.TRG_ORDERS, Number(entitlement.order_id), "object_missing", options.nowMs);
    return errorResponse("download_temporarily_unavailable", 503);
  }
  if (!object.body || Number(object.size) !== Number(entitlement.object_size_bytes)) {
    await markFulfillmentFailure(env.TRG_ORDERS, Number(entitlement.order_id), "object_size_mismatch", options.nowMs);
    return errorResponse("download_temporarily_unavailable", 503);
  }

  try {
    await recordSuccessfulDownload(env.TRG_ORDERS, entitlement, { nowMs: options.nowMs });
  } catch {
    return errorResponse("download_temporarily_unavailable", 503);
  }

  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${entitlement.customer_filename}"; filename*=UTF-8''${encodeURIComponent(entitlement.customer_filename)}`,
    "content-type": entitlement.content_type,
    "pragma": "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (Number.isInteger(Number(object.size)) && Number(object.size) >= 0) {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { headers, status: 200 });
}

async function handleNativeAuthorizedDownload(request, env, authorization, options) {
  const entitlement = await getNativeEntitlementByDownloadReference(
    env.TRG_ORDERS,
    authorization.entitlementReference
  );
  const session = options.accountSession === undefined
    ? await getSessionFromRequest(request, env, options.accountSessionOptions || {})
    : options.accountSession;
  const authorized = isNativeEntitlementOwnedBySession(entitlement, session)
    && isValidNativeDeliverySnapshot(entitlement, env);
  if (!authorized) return errorResponse("download_not_authorized", 403);

  let object;
  try {
    object = await env.TRG_PRODUCTS.get(entitlement.delivery_r2_key_snapshot);
  } catch {
    return failNativeDelivery(env.TRG_ORDERS, entitlement.order_id, "object_read_failed", options);
  }
  if (!object?.body) {
    return failNativeDelivery(env.TRG_ORDERS, entitlement.order_id, "object_missing", options);
  }
  try {
    await recordNativeSuccessfulDownload(env.TRG_ORDERS, entitlement, { nowMs: options.nowMs });
  } catch {
    return failNativeDelivery(env.TRG_ORDERS, entitlement.order_id, "download_audit_failed", options);
  }
  const filename = entitlement.delivery_filename_snapshot;
  const headers = downloadHeaders(filename, "application/pdf", object.size);
  return new Response(object.body, { headers, status: 200 });
}

async function failNativeDelivery(database, orderId, failureCode, options) {
  try {
    await markNativeDeliveryFailure(database, Number(orderId), failureCode, { nowMs: options.nowMs });
  } catch {
    // Delivery still fails closed if its recoverability marker cannot be written.
  }
  return errorResponse("download_temporarily_unavailable", 503);
}

function isValidNativeDeliverySnapshot(entitlement, env = {}) {
  const key = String(entitlement?.delivery_r2_key_snapshot || "");
  const filename = String(entitlement?.delivery_filename_snapshot || "");
  const contentType = String(entitlement?.delivery_content_type_snapshot || "").toLowerCase();
  const stagingAcceptanceKey = String(env.PAYMENT_PIPELINE_STAGE || "").trim().toLowerCase() === "staging"
    && key.startsWith("acceptance/");
  return (key.startsWith("catalog-publications/") || stagingAcceptanceKey)
    && key.endsWith("/delivery.pdf")
    && !key.includes("\\")
    && !key.split("/").includes("..")
    && filename.length > 4
    && filename.length <= 180
    && filename.toLowerCase().endsWith(".pdf")
    && !/[\\/\r\n\"]/.test(filename)
    && contentType === "application/pdf";
}

function downloadHeaders(filename, contentType, size) {
  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "content-type": contentType,
    "pragma": "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (Number.isInteger(Number(size)) && Number(size) >= 0) headers.set("content-length", String(size));
  return headers;
}

function errorResponse(error, status) {
  return new Response(JSON.stringify({ error }), {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    },
    status
  });
}
