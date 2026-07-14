import { createDownloadCredential, isDownloadSigningSecretConfigured } from "./download-authorization.mjs";
import { OrderAccessError, verifyOrderAccessToken } from "./order-access.mjs";
import { getOrderById, getOrderItems } from "./orders-d1.mjs";
import { getOrderEntitlements } from "./order-fulfillment.mjs";

export async function handleOrderAccessPage(request, env = {}, options = {}) {
  if (!env.TRG_ORDERS
    || !env.ORDER_ACCESS_SIGNING_SECRET
    || !isDownloadSigningSecretConfigured(env.DOWNLOAD_SIGNING_SECRET)) {
    return renderPage("Order access is temporarily unavailable.", unavailableBody(), 503);
  }
  const token = new URL(request.url).searchParams.get("credential") || "";
  let access;
  try {
    access = await verifyOrderAccessToken(
      env.TRG_ORDERS,
      token,
      env.ORDER_ACCESS_SIGNING_SECRET,
      { nowMs: options.nowMs }
    );
  } catch (error) {
    const status = error instanceof OrderAccessError ? 403 : 503;
    return renderPage("Order access was not authorized.", unauthorizedBody(), status);
  }

  const order = await getOrderById(env.TRG_ORDERS, Number(access.order_id));
  if (!order || order.payment_status !== "paid") {
    return renderPage("Order access was not authorized.", unauthorizedBody(), 403);
  }
  if (order.fulfillment_status === "failed") {
    return renderPage("Your order needs assistance.", supportBody(order, env), 200);
  }
  if (!["ready", "fulfilled"].includes(order.fulfillment_status)) {
    return renderPage("Your downloads are being prepared.", preparingBody(order), 200);
  }
  const [items, entitlements] = await Promise.all([
    getOrderItems(env.TRG_ORDERS, Number(order.id)),
    getOrderEntitlements(env.TRG_ORDERS, Number(order.id), { activeOnly: true })
  ]);
  if (!entitlements.length) {
    return renderPage("Your downloads are being prepared.", preparingBody(order), 200);
  }

  const itemTitles = new Map(items.map((item) => [item.product_slug, item.product_title_snapshot]));
  const controls = [];
  for (const entitlement of entitlements) {
    const credential = await createDownloadCredential(
      entitlement,
      env.DOWNLOAD_SIGNING_SECRET,
      { nowMs: options.nowMs }
    );
    const title = itemTitles.get(entitlement.product_slug) || entitlement.product_slug;
    controls.push(`<li class="delivery-item"><strong>${escapeHtml(title)}</strong><a class="button" href="/store/download?credential=${encodeURIComponent(credential)}">Download ${escapeHtml(entitlement.customer_filename)}</a></li>`);
  }
  return renderPage("Your downloads", `
    <p class="section-heading__kicker">Order Delivery</p>
    <h1>Your downloads are ready.</h1>
    <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
    <ul class="delivery-list">${controls.join("")}</ul>
    <p class="cart-summary__copy">Each download button uses short-lived authorization. Reload this order link if a button expires.</p>
  `, 200);
}

function unauthorizedBody() {
  return `
    <p class="section-heading__kicker">Order Delivery</p>
    <h1>This order link is not valid.</h1>
    <p class="cart-summary__copy">The link may have been altered or revoked. Contact Tobacco Road Games support for help.</p>
  `;
}

function unavailableBody() {
  return `
    <p class="section-heading__kicker">Order Delivery</p>
    <h1>Order access is temporarily unavailable.</h1>
    <p class="cart-summary__copy">Please try again shortly. Your payment and order records are not affected.</p>
  `;
}

function preparingBody(order) {
  return `
    <p class="section-heading__kicker">Order Delivery</p>
    <h1>Your downloads are being prepared.</h1>
    <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
    <p class="cart-summary__copy">Refresh this page shortly.</p>
  `;
}

function supportBody(order, env) {
  const support = String(env.RESEND_REPLY_TO || "Tobacco Road Games support");
  return `
    <p class="section-heading__kicker">Order Delivery</p>
    <h1>Your order needs assistance.</h1>
    <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
    <p class="cart-summary__copy">Contact ${escapeHtml(support)} and include the order reference above.</p>
  `;
}

function renderPage(title, body, status) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css?v=20260714a">
<style>.delivery-list{display:grid;gap:14px;padding:0;list-style:none}.delivery-item{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:16px;border:1px solid rgba(242,216,170,.16);border-radius:12px}@media(max-width:640px){.delivery-item{align-items:stretch;flex-direction:column}}</style>
</head><body class="view-section"><div class="page-shell"><header class="site-header"><a class="brand" href="/" aria-label="Tobacco Road Games home"><img class="brand__logo" src="/assets/logo.png?v=20260709c" alt="Tobacco Road Games logo"><div class="brand__copy"><span class="brand__name">Tobacco Road Games</span><span class="brand__tag">Publisher-owned store and workshop catalog</span></div></a></header><main><section class="store-section statement-page"><div class="statement-content">${body}</div></section></main></div></body></html>`, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    },
    status
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
