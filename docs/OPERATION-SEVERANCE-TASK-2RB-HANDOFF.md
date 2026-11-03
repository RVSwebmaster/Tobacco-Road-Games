# Operation Severance Task 2R-B Handoff

Date: 2026-11-03  
Branch: `codex/operation-severance-task1`  
Starting commit: `5b788dc27460f5fcccae9d2ad3d7da73cb4e15a6`  
Staging D1: `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`)  
Staging R2: `trg-products-staging`  
Production: untouched

## Outcome

Agency now has one authoritative, retired D1 continuity identity and its two existing paid entitlements authorize against D1 plus their immutable entitlement snapshots. Agency no longer requires `shared/runtime-catalog.mjs`, `data/products.json`, or the generated delivery mapping for secure-download authorization or fulfillment repair.

The authoritative Agency PDF was not available in the repository, Git object history, or approved staging assets. The exact staging R2 key `agency/product.pdf` still does not exist. Ownership continuity is preserved, but live byte delivery remains unavailable and fails closed with HTTP 503. Task 2R-B therefore resolves the code and identity migration blocker but does **not** establish zero remaining legacy blockers: recovery of the authoritative 9,630,946-byte Agency PDF is still required.

GitHub remains absent from marketplace runtime operations. No production system was modified or deployed.

## Migration and staging evidence

Only `068_agency_legacy_continuity.sql` was pending when the staging gate was opened. Before migration:

- `runtime_settings.store_state`: `CLOSED`;
- Agency product identities: 0;
- Agency orders: 6 (`paid` 2, `failed` 2, `pending` 1, `expired` 1);
- active Agency entitlements: 2.

The first apply attempt failed safely with `SQLITE_AUTH` because Cloudflare D1 does not permit a temporary guard table in a migration. No product, guard table, order, or entitlement change occurred. The guard was changed to an ordinary migration-scoped table that is dropped atomically. The corrected migration then applied successfully.

After migration:

- no migrations remain pending;
- `runtime_settings.store_state`: `CLOSED`;
- exactly one product exists with ID `legacy:agency`, slug `agency`, Creator `creator-rv-sawyer`, publication state `retired`, status `legacy-not-for-sale`, buy mode `retired`, revision 1, and a `2R-B` continuity marker;
- `creator_listing_id` and `delivery_r2_key` remain null;
- all 6 order records and their status distribution remain unchanged;
- both paid entitlements remain active with `agency/product.pdf`, `Agency.pdf`, `application/pdf`, and 9,630,946 bytes;
- no product rows exist for `circle-of-cinder`, `janni`, `ringbound`, or `tablecraft-primer`;
- no migration guard table remains.

The migration is retry-safe for the exact identity and aborts on a conflicting Agency ID/slug/Creator/state tuple. It never inserts, updates, or deletes orders or entitlements.

## Secure-delivery behavior

The legacy credential flow still requires a valid HMAC credential, exact entitlement/order/order-item/slug tuple, active entitlement, and paid order. Agency then additionally requires:

- the exact retired D1 continuity identity;
- the exact stored entitlement key `agency/product.pdf`;
- filename `Agency.pdf`;
- content type `application/pdf`;
- stored object size 9,630,946 bytes.

The route streams `object.body` directly from `TRG_PRODUCTS`, records successful attempts transactionally, rejects altered credentials and substituted delivery keys, rejects object-size mismatches, and exposes no private key in its JSON errors. Fulfillment repair reuses the existing entitlement; it cannot create a new Agency entitlement from generated data.

Unit coverage demonstrated successful exact-byte streaming using a controlled R2 fixture and verified retry idempotency. The native staging R2 read returned `The specified key does not exist`, so an actual staging download could not be completed and is not claimed.

## Authoritative asset search

- Repository and ignored workspace PDFs: only the unrelated Spriggans sample was present.
- Git object history: no Agency PDF or recoverable Agency product asset was present.
- Approved staging Office archive: contained only unrelated books (`heiser_unseen_realm_2015.pdf` and `the-harbinger.pdf`).
- Production R2 was not read from or modified because this task authorized staging only.

No substitute or fabricated PDF was uploaded.

## Legacy test disposition

The obsolete `test:legacy-catalog-publication` harness is formally retired and now delegates to `test:agency-legacy-continuity`. The replacement covers:

- exact six-order/two-entitlement preservation;
- one and only one Agency identity across retries;
- collision rejection;
- nonpublication of the other four historical products;
- paid/active authorization;
- exact snapshot and R2 size enforcement;
- missing-object failure without ownership loss;
- substituted-key and unrelated-slug rejection;
- fulfillment-repair idempotency without entitlement creation.

The targeted continuity suite is part of `npm test` through `pretest`.

## Verification results

Passed:

- `npm run test:agency-legacy-continuity`;
- retired `npm run test:legacy-catalog-publication` entry point;
- `npm run test:operation-severance`;
- `npm run test:product-catalog-d1`;
- `npm run test:native-d1-delivery`;
- secure-download regression (`node scripts/test-secure-download.js`);
- full `npm test`;
- `npm run build:pages` — 218 allowlisted files;
- `npm run test:pages-build`;
- Wrangler 4.44.0 Pages Functions compilation;
- `npm run test:storefront-visual`;
- runtime GitHub dispatch/API/token scan — zero executable matches.

Expected and safely handled staging limitation:

- `trg-products-staging/agency/product.pdf` — key not found.

## Remaining generated-catalog dependencies

Agency no longer traverses a generated-catalog compatibility branch for ownership or download authorization. Repository-wide inspection still finds dormant/general legacy compatibility code in:

- cart/quote/checkout and pending-order fallbacks;
- legacy anonymous free download;
- Creator Balance purchase compatibility;
- My Library legacy presentation enrichment;
- product inactivity fallback;
- Owner Pricing and Owner Intake legacy discovery;
- static homepage/build hydration;
- the disabled Owner publish endpoint;
- the generic non-Agency branches of `product-delivery.mjs`, `download-route.mjs`, and `order-fulfillment.mjs`.

The generated catalog is empty and none of these paths supplies Agency after migration. They remain dead/retired compatibility cleanup, not a reason to republish historical products. This task intentionally did not expand into their wholesale removal.

## Files changed

- `migrations/068_agency_legacy_continuity.sql`
- `functions/_lib/legacy-product-continuity.mjs`
- `functions/_lib/download-route.mjs`
- `functions/_lib/order-fulfillment.mjs`
- `scripts/test-agency-legacy-continuity.js`
- `scripts/test-legacy-catalog-publication.js`
- `scripts/test-secure-download.js`
- `scripts/test-product-catalog-d1.js`
- `scripts/test-product-publication.js`
- `package.json`
- this handoff

## Required final continuity action

Locate the authoritative Agency PDF through an Owner-approved source, verify that it is exactly the purchased artifact, upload it to staging as `agency/product.pdf`, and verify its digest and 9,630,946-byte length before running the real secure-download route. Do not change the two entitlement snapshots or create replacement ownership records.
