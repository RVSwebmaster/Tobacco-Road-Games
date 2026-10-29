# D1 product catalog foundation (Task 2A)

Migration `057_marketplace_product_catalog.sql` creates `marketplace_products`. It stores stable product identity (`id`, immutable `slug`), Creator ownership (`creator_id` and optional one-to-one `creator_listing_id`), publication and storefront status, buy mode, core descriptive fields, currency, fixed/free/PWYW pricing, sale schedule, explicit cover/preview/thumbnail/delivery R2 keys, delivery filename and content type, and JSON metadata for the remaining catalog details (authors, formats, tags, features, version, discovery attributes, and similar fields). `created_at`, `updated_at`, `published_at`, and `revision` support history and controlled updates.

The migration does **not** alter `order_items`, `download_entitlements`, or `creator_sale_snapshots`. Those records retain their sale-time product slug, title, price, identity, and delivery-key snapshots. Product slugs, IDs, and Creator ownership cannot be changed, and products are retired instead of deleted. Existing Creator listing IDs can be used as product IDs during migration, with `creator_listing_id` preserving the explicit relationship. A linked listing must belong to the same Creator.

`functions/_lib/product-catalog-d1.mjs` provides `createProduct`, `getProductById`, `getProductBySlug`, `listProducts`, and `updateProduct`. It uses only Cloudflare D1 prepared statements. Create and update validate pricing and R2 keys; updates use `revision` to reject stale writes. `listProducts` supports Creator, publication-state, and storefront-status filters with bounded pagination. Flexible `metadata` may not shadow authoritative columns.

This is a data layer only. It is not called by storefront, checkout, fulfillment, or Owner Intake routes, and migration 057 has not been applied to production D1. Publication remains unavailable under Task 1's severance guard.

## Remaining integration requirements

Task 2B and later work must migrate existing product records and asset references, decide which legacy static assets move to R2, connect public and Owner reads to D1, implement a Cloudflare-only publication transaction, and then adapt storefront, checkout, downloads, pricing, homepage, bundle, Creator, and inactivity consumers. Preserve historical snapshots and keep publication unavailable until all required reads and writes are connected and verified.
