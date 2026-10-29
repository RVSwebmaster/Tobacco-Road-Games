# Operation Severance — Task 2F Checkpoint

Task 2F connects native D1 products to the existing browser cart and `/api/cart/quote` pricing path while keeping native payment, order creation, entitlement, and fulfillment disabled.

## Authority and compatibility

- Requested cart slugs are resolved through `marketplace_products` at quote time. D1 supplies native identity, revision, publication state, Creator eligibility, status, buy mode, currency, pricing model, fixed/free/PWYW amounts, sales, and public cover URL.
- A D1 record always wins a slug collision, including when the D1 record is draft, paused, retired, or otherwise unavailable. The resolver never falls back to a conflicting legacy price.
- Slugs with no D1 identity may continue through the generated legacy catalog. Existing legacy checkout and mixed legacy/native quote presentation remain compatible.
- Fixed-price and free native products ignore browser-submitted amounts. PWYW accepts only safe integer cents at or above the D1 minimum. Every request re-reads the current D1 revision, so stale titles, bounds, and prices are replaced by current server values.
- Native delivery R2 keys remain available only inside the server-side resolver for future fulfillment integration. Quote and cart responses expose only the public `/product-assets/{slug}/cover.webp` URL.

## Payment boundary

Native products can be added to the existing cart and receive a verified server quote. A quote containing any native product sets `checkoutAllowed: false`; the browser keeps checkout disabled and explains that native payment/acquisition is not active.

The checkout endpoint independently re-resolves the cart. Any valid native item returns `native_checkout_unavailable` before creating an order, calling Stripe, issuing an entitlement, or invoking fulfillment. Free native products are subject to the same boundary.

## Remaining integration work

- Native checkout must later create durable order snapshots that retain D1 product ID/revision and resolve delivery through the explicit D1 R2 key.
- Stripe, zero-dollar acquisition, entitlement creation, secure delivery, customer libraries, refunds, and Creator sale accounting remain legacy-only.
- `functions/_lib/orders-pending.mjs` and `functions/_lib/creator-balance-route.mjs` retain legacy runtime-catalog paths. The public pending-order route remains disabled.
- The embedded cart-page catalog remains a legacy estimate cache. Native cart lines intentionally wait for `/api/cart/quote`, which supplies their current title, cover, detail URL, and authoritative price.
- `shared/runtime-catalog.mjs` remains the compatibility source for non-D1 legacy products and the existing tax-inclusive policy. It is not consulted for a slug that exists in D1.

No GitHub operation is part of the cart, quote, or compatibility path. Production was not changed.
