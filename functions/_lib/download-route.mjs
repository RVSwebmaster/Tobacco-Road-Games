import { DownloadAuthorizationError, verifyDownloadCredential } from "./download-authorization.mjs";
import {
  getEntitlementById,
  markFulfillmentFailure,
  recordSuccessfulDownload
} from "./order-fulfillment.mjs";
import { getDeliveryProduct, isExactDeliveryMapping } from "./product-delivery.mjs";

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

  const entitlement = await getEntitlementById(env.TRG_ORDERS, authorization.entitlementId);
  const product = getDeliveryProduct(authorization.productSlug);
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

  try {
    await recordSuccessfulDownload(env.TRG_ORDERS, entitlement, { nowMs: options.nowMs });
  } catch {
    return errorResponse("download_temporarily_unavailable", 503);
  }

  const headers = new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${product.customerFilename}"; filename*=UTF-8''${encodeURIComponent(product.customerFilename)}`,
    "content-type": product.contentType,
    "pragma": "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (Number.isInteger(Number(object.size)) && Number(object.size) >= 0) {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { headers, status: 200 });
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
