import { clearCheckoutAccessCookie, readCheckoutAccessCookie } from "./checkout-cookie.mjs";
import { createDownloadCredential, isDownloadSigningSecretConfigured } from "./download-authorization.mjs";
import { getOrderEntitlements } from "./order-fulfillment.mjs";
import { getOrderByPublicId } from "./orders-d1.mjs";

const CACHE_BUST = "20260709b";

export async function handleCheckoutCompletePage(request, env = {}) {
  const cookieSecret = String(env.CHECKOUT_ACCESS_COOKIE_SECRET || "");
  const checkoutAccess = cookieSecret ? await readCheckoutAccessCookie(request, cookieSecret) : null;
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  const order = checkoutAccess?.publicOrderReference && env.TRG_ORDERS
    ? await getOrderByPublicId(env.TRG_ORDERS, checkoutAccess.publicOrderReference)
    : null;
  const matched = Boolean(
    checkoutAccess
      && sessionId
      && checkoutAccess.stripeCheckoutSessionId === sessionId
      && order
      && order.stripe_checkout_session_id === sessionId
  );

  const paid = matched && order.payment_status === "paid";
  const paidBody = paid ? await renderPaidOrderBody(order, env) : "";
  return htmlPage({
    body: paid
      ? paidBody
      : matched
        ? `
        <p class="section-heading__kicker">Checkout Return</p>
        <h1>Payment processing.</h1>
        <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
        <p class="cart-summary__copy">Stripe returned your browser, but Tobacco Road Games has not yet received verified webhook confirmation. Refresh this page shortly to check the server-recorded status.</p>
        <p class="cart-summary__copy">Delivery and fulfillment are not enabled yet.</p>
        <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
      `
        : `
        <p class="section-heading__kicker">Checkout Return</p>
        <h1>Stripe returned you to Tobacco Road Games.</h1>
        <p class="cart-summary__copy">The browser return is not proof of payment. If you need help, return to the cart and start a fresh checkout attempt.</p>
        <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
      `,
    title: "Checkout Complete | Tobacco Road Games"
  }, paid || !matched ? clearCheckoutAccessCookie() : null);
}

async function renderPaidOrderBody(order, env) {
  let fulfillmentBody = `
    <p class="cart-summary__copy">Your payment is confirmed. Your download is being prepared. Refresh this page shortly.</p>
  `;
  if (order.fulfillment_status === "failed") {
    fulfillmentBody = `
      <p class="cart-summary__copy">We received your payment, but your download needs attention. Please contact Tobacco Road Games support and include the order reference below.</p>
    `;
  } else if (["ready", "fulfilled"].includes(order.fulfillment_status)) {
    const entitlements = await getOrderEntitlements(env.TRG_ORDERS, Number(order.id), { activeOnly: true });
    const entitlement = entitlements.length === 1 ? entitlements[0] : null;
    if (entitlement && isDownloadSigningSecretConfigured(env.DOWNLOAD_SIGNING_SECRET)) {
      const credential = await createDownloadCredential(entitlement, env.DOWNLOAD_SIGNING_SECRET);
      fulfillmentBody = `
        <p class="cart-summary__copy">Your Agency PDF is ready.</p>
        <p class="cart-summary__copy"><a class="button" href="/store/download?credential=${encodeURIComponent(credential)}">Download Agency PDF</a></p>
        <p class="cart-summary__copy">This private download link expires shortly. Browser retries are allowed while it remains active.</p>
      `;
    }
  }

  return `
    <p class="section-heading__kicker">Checkout Return</p>
    <h1>Payment confirmed.</h1>
    <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
    <p class="cart-summary__copy">Tobacco Road Games has received verified payment confirmation from Stripe.</p>
    ${fulfillmentBody}
    <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
  `;
}

export async function handleCheckoutCanceledPage(request, env = {}) {
  const cookieSecret = String(env.CHECKOUT_ACCESS_COOKIE_SECRET || "");
  const checkoutAccess = cookieSecret ? await readCheckoutAccessCookie(request, cookieSecret) : null;
  const order = checkoutAccess?.publicOrderReference && env.TRG_ORDERS
    ? await getOrderByPublicId(env.TRG_ORDERS, checkoutAccess.publicOrderReference)
    : null;

  return htmlPage({
    body: `
      <p class="section-heading__kicker">Checkout Canceled</p>
      <h1>Checkout was canceled.</h1>
      <p class="cart-summary__copy">Your browser cart is still available on the Tobacco Road Games site.</p>
      ${order ? `<p class="cart-summary__copy">Most recent pending order reference: <strong>${escapeHtml(order.public_id)}</strong></p>` : ""}
      <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
    `,
    title: "Checkout Canceled | Tobacco Road Games"
  }, clearCheckoutAccessCookie());
}

function htmlPage({ title, body }, setCookie) {
  const headers = {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer"
  };
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Checkout return page for Tobacco Road Games.">
  <link rel="icon" type="image/png" href="/assets/logo.png?v=${CACHE_BUST}">
  <link rel="stylesheet" href="/styles.css?v=${CACHE_BUST}">
</head>
<body class="view-section">
  <div class="page-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="Tobacco Road Games home">
        <img class="brand__logo" src="/assets/logo.png?v=${CACHE_BUST}" alt="Tobacco Road Games logo">
        <div class="brand__copy">
          <span class="brand__name">Tobacco Road Games</span>
          <span class="brand__tag">Publisher-owned store and workshop catalog</span>
        </div>
      </a>
      <nav class="site-nav" aria-label="Store navigation">
        <a href="/">Home</a>
        <a href="/store/">Store</a>
        <a href="/store/cart/">Cart</a>
      </nav>
    </header>
    <main>
      <section class="store-section statement-page">
        <div class="statement-content">
          ${body}
        </div>
      </section>
    </main>
  </div>
</body>
</html>`, {
    headers,
    status: 200
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
