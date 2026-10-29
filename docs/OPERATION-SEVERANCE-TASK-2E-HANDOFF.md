# Operation Severance — Task 2E Checkpoint

Task 2E makes the Cloudflare D1 catalog authoritative for newly published public products without changing checkout, fulfillment, customer libraries, Owner Intake, or Creator publication.

## Public behavior

- `/api/catalog` reads published `marketplace_products` records from `TRG_ORDERS`, requires an approved and active Creator, and returns only public metadata and public asset URLs. It never returns R2 object keys or delivery filenames.
- `/store/` and `/store/catalog/` load the public API at runtime. Published D1 products are merged into the existing browser controls, search, sorting, shelf, and card views without a build or deployment.
- `/store/products/{slug}/` is a dynamic Pages Function. It renders the current D1 metadata on every request and uses `/product-assets/{slug}/cover.webp` and the optional public preview route.
- Homepage Best Sellers now resolves sold product slugs through D1 instead of the generated homepage product map.
- Drafts, paused products, suspended/closed Creators, and unknown slugs are not returned by the public D1 API or rendered as native public detail pages.

## Compatibility rule

Existing pre-rendered legacy cards and static product pages remain valid pending catalog migration. A published D1 product with the same slug replaces the legacy card in the browser and its dynamic detail route takes precedence. A draft D1 record does not suppress a separately published legacy record. This prevents duplicate public cards while allowing migration one product at a time.

Native D1 products deliberately do not emit `data-cart-add` controls. Their current price and PWYW minimum/suggestion are displayed, but purchase controls report temporary unavailability. Connecting D1 products to quote, checkout, payment, entitlement, and delivery is a later task and was not smuggled into Task 2E.

## Remaining repository-generated catalog dependencies

These are explicit follow-on integration requirements, not Task 2E work:

- Checkout and quoting: `functions/_lib/cart-quote.mjs` and `functions/_lib/cart-checkout.mjs` still read `runtime-catalog.mjs`.
- Fulfillment and libraries: `functions/_lib/free-download.mjs`, `functions/_lib/product-delivery.mjs`, and the compatibility path in `functions/_lib/account-library.mjs` still use generated catalog data; free download also uses `shared/product-folder-map.mjs`.
- Order and Creator operations: `functions/_lib/orders-pending.mjs`, `functions/_lib/creator-balance-route.mjs`, `functions/_lib/creator-operations.mjs`, `functions/_lib/creator-publication.mjs`, and `functions/_lib/product-inactivity.mjs` still use generated runtime product records.
- Owner tools: `assets/js/owner-pricing-editor.js`, `assets/js/owner-homepage-editor.js`, and the legacy compatibility read in `assets/js/product-intake.js` still fetch `data/products.json`.
- Guest previews: `assets/js/guest-product-preview.js` and `assets/js/guest-product-preview-profile.js` still read generated guest preview JSON.
- Legacy generation tooling: `scripts/build-store.js`, `scripts/build-runtime-catalog.mjs`, `scripts/sync-r2-products.js`, and `scripts/publish-intake.js` still generate or mutate repository catalog artifacts. They are development/legacy tooling and are not used by the new public D1 path.
- Disabled legacy publication helpers: `functions/_lib/owner-publish.mjs` retains folder-map validation for its intentionally unavailable compatibility path; it does not publish.

The next commerce integration must preserve historical order and entitlement snapshots while moving price authority, checkout eligibility, and delivery-key lookup to D1. Production remains untouched until that path is separately implemented and proven.
