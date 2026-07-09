import { clearCheckoutAccessCookie, readCheckoutAccessCookie } from "./checkout-cookie.mjs";
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

  return htmlPage({
    body: matched
      ? `
        <p class="section-heading__kicker">Checkout Return</p>
        <h1>Stripe sent you back to Tobacco Road Games.</h1>
        <p class="cart-summary__copy">Order reference: <strong>${escapeHtml(order.public_id)}</strong></p>
        <p class="cart-summary__copy">Payment status is still <strong>${escapeHtml(order.payment_status)}</strong> in this phase. Delivery and fulfillment are not enabled yet.</p>
        <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
      `
      : `
        <p class="section-heading__kicker">Checkout Return</p>
        <h1>Stripe returned you to Tobacco Road Games.</h1>
        <p class="cart-summary__copy">This phase does not use the Checkout Session ID as authorization. If you need help, return to the cart and start a fresh checkout attempt.</p>
        <p class="cart-summary__copy"><a class="button button--secondary" href="/store/cart/">Return to Cart</a></p>
      `,
    title: "Checkout Complete | Tobacco Road Games"
  }, clearCheckoutAccessCookie());
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
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "set-cookie": setCookie
    },
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
