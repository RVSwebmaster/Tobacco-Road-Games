export function isPublicStorePage(pathname) {
  if (!pathname.startsWith("/store/")) return false;
  return !["/store/checkout/complete", "/store/checkout/canceled", "/store/order-access", "/store/download"]
    .some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function maintenanceResponse() {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Store Maintenance | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css"></head><body class="view-section"><main class="page-shell"><section class="store-section store-callout" style="margin-top:4rem"><div class="store-callout__copy"><p class="section-heading__kicker">Store Maintenance</p><h1>The store is temporarily closed.</h1><p>We are working on the Tobacco Road Games store. Purchasing is disabled, but the rest of the website remains available.</p><div class="hero__actions"><a class="button button--primary" href="/">Return to Tobacco Road Games</a></div></div></section></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, status: 503 });
}
