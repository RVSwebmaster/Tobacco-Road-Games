# Operation Severance: Task 2 handoff

Task 2A now provides the D1 schema and product-data module described in [D1 product catalog foundation](D1-PRODUCT-CATALOG-FOUNDATION.md). The integration work below remains for subsequent tasks.

Task 1 removes the runtime GitHub publishing path. Product, pricing, homepage, bundle, and pause publication now return HTTP 503 after relevant validation and do not promote files or mark products published. Creator compliance review, file decisions, and bundle approval remain available. No deployment was made as part of Task 1.

## Repository-generated product data still in use

These dependencies are deliberately preserved for the authorized D1 catalog reconstruction:

| Source or consumer | Current dependency | Task 2 replacement |
| --- | --- | --- |
| `data/products.json`, `data/homepage.json`, `data/bundle-rules.json`, `data/product-intake-map.json`, `shared/product-folder-map.mjs` | Repository-held catalog, homepage choices, bundle rules, and slug-to-R2-folder mapping | Migrate authoritative records and relationships to D1; retain R2 for objects. |
| `scripts/build-store.js`, `scripts/build-runtime-catalog.mjs`, `shared/runtime-catalog.mjs`, `shared/homepage-product-catalog.mjs` | Build-time generation of storefront pages, public product data, and a bundled Worker catalog | Serve catalog and product pages from D1 without a repository build for business changes. |
| `functions/_lib/runtime-catalog.mjs` | Reads generated `shared/runtime-catalog.mjs` | Replace with D1 catalog queries and a deliberate cache strategy. |
| `functions/_lib/cart-quote.mjs`, `cart-checkout.mjs`, `orders-pending.mjs`, `creator-balance-route.mjs` | Prices, saleability, and order snapshots derive from the bundled catalog | Read D1 catalog and preserve sale-time snapshots and pricing checks. |
| `functions/_lib/free-download.mjs`, `product-delivery.mjs`, `account-library.mjs` | Eligibility and delivery metadata derive from generated products; free download also uses the static folder map | Resolve D1 product and delivery records while preserving entitlements and private R2 delivery. |
| `functions/product-assets/[slug]/[asset].js` | Uses generated slug-to-folder map for public images | Resolve approved image objects through D1-backed mapping. |
| `functions/_lib/creator-operations.mjs`, `creator-publication.mjs`, `product-inactivity.mjs` | Listing compatibility, slug checks, and inactivity decisions consult the bundled catalog | Use D1 product identity and publication state. Rebuild publication and pause atomically before enabling actions. |
| `functions/_lib/owner-publish.mjs` | Validation determines existing products through the generated folder map | Use D1 identity and asset references when the Cloudflare publish transaction is implemented. |
| `assets/js/product-intake.js`, `owner-pricing-editor.js`, `owner-homepage-editor.js` | Owner screens fetch static `/data/products.json`; homepage editor also fetches `/data/homepage.json` | Load D1-backed Owner APIs; re-enable publication only when Cloudflare writes and reads are complete. |
| Generated `index.html`, `store/` pages, `scripts/build-pages-output.mjs` | Static pages and copied public `data/` reflect repository state | Preserve Pages hosting, but provide runtime catalog views and prevent public static data from overriding D1 state. |

The retired `scripts/publish-intake.js` and `scripts/sync-r2-products.js` still contain repository-data transformation code for development and migration reference. They are not wired to runtime endpoints or a publishing workflow. They must not be used to complete marketplace transactions.

## Retired end-to-end test scenarios

The optional `test-creator-product-publication-sandbox`, `test-creator-active-shelf-slots`, `test-creator-product-withdrawal`, `test-creator-publishing-end-to-end`, and `test-product-inactivity-shelf-expiration` scripts still model the former publish-and-redeploy completion path. They now stop at the expected HTTP 503 response. Rebuild these end-to-end scenarios against the D1 catalog and Cloudflare publication path in Task 2. The default suite and `test:operation-severance` cover the current fail-closed behavior.
