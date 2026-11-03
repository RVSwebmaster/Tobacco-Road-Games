# Operation Severance — Task 2R-A Handoff

Audit date: November 3, 2026

Branch: `codex/operation-severance-task1`

Audited checkpoint: `16cd615e926aaf284281f3f8019fe0c67c05a686`

Cloudflare target inspected: D1 `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`) and R2 `trg-products-staging`

Production: not inspected or changed

## Executive conclusion

Executable marketplace code contains **zero GitHub API, repository-dispatch, workflow-dispatch, GitHub-token, or runtime GitHub publication calls**. Owner publication, Creator submission/review/catalog management, D1 storefront discovery, pricing, orders, Stripe webhook processing, entitlements, the native customer library, and native secure delivery all have Cloudflare-native implementations.

Operation Severance is nevertheless **not complete** at this checkpoint. The remaining blocker is the legacy compatibility layer:

- several executable routes still import repository-generated catalog modules or fetch repository-maintained product JSON;
- the only current legacy operational identity is `agency`, represented by existing D1 order and entitlement snapshots but not by a D1 product record;
- legacy secure download and fulfillment reconstruct an allowlisted delivery mapping from the generated runtime catalog;
- the generated runtime catalog is intentionally empty, so the two retained paid Agency entitlements cannot pass that mapping check;
- the referenced `agency/product.pdf` object is also absent from the staging R2 bucket, so staging download continuity cannot currently be demonstrated even after removing the generated-catalog lookup.

There is no active legacy public catalog to migrate wholesale. The current repository contains zero products in `data/products.json`, zero generated runtime products, and an empty product-folder map. Five former catalog entries were deliberately cleared at commit `5a083bd` (`agency`, `circle-of-cinder`, `janni`, `ringbound`, and `tablecraft-primer`). Of those, only `agency` has current operational records in staging D1. The other four are historical source records, not current marketplace records, and should not be republished merely to complete Severance.

The minimum completion task is therefore a narrow Agency continuity migration plus removal of all executable generated-catalog compatibility branches. Production rollout and production-data verification remain a separate authorized checkpoint.

## Staging evidence

All staging inspection was read-only. No migration, deployment, D1 write, or R2 write was performed.

- Authenticated account: Cloudflare account `5d75bd5036e763952313fa55078f5e42`.
- D1 database: `trg-orders-staging`, UUID `d92594e8-a45c-4f84-8f48-7c3aeba17f29`.
- `runtime_settings.store_state`: `CLOSED` before and after inspection.
- Applied migrations: 68 ledger rows through `067_native_guest_claim_credentials.sql`.
- Pending migrations: none.
- `marketplace_products`: 0 rows.
- `creator_listings`: 0 rows.
- `native_product_entitlements`: 0 rows.
- Approved Creator identity available for migration: `creator-rv-sawyer` / `rv-sawyer` / `RV Sawyer`.
- Legacy orders: 6, all for `agency` (2 paid, 2 failed, 1 pending, 1 expired).
- Legacy paid order items: immutable title `Agency`, author slug `rv-sawyer`, version `1.0`, last-updated snapshot `2026-06-24`, USD; list-price snapshot 400 cents and selected/effective price 300 cents.
- Legacy entitlements: 2 active rows across 2 paid orders.
- Entitlement delivery snapshot: `agency/product.pdf`, `Agency.pdf`, `application/pdf`, 9,630,946 bytes.
- Staging R2 verification: `trg-products-staging/agency/product.pdf` returned “The specified key does not exist.” The zero-byte local failure artifact was removed immediately.

The latest-code isolated preview `task2pb-verify.tobacco-road-games-staging.pages.dev` returned:

- `/api/catalog`: HTTP 200 with zero D1 products;
- `/api/homepage-shelves`: HTTP 200 with revision 1 and empty D1 shelves;
- `/data/products.json`: HTTP 200 with `[]`;
- `/store/products/agency/`: HTTP 404;
- `/product-assets/agency/cover.webp`: HTTP 404.

The shared staging alias returned the same empty catalog and Agency 404 behavior, but `/api/homepage-shelves` returned HTTP 404. That alias is behind the audited branch; the latest-code preview returned the endpoint correctly. This is a deployment-rollout mismatch, not a GitHub runtime dependency. This audit did not deploy to correct it.

## Classified findings

### 1. Runtime blockers

| ID | Finding | Evidence | Required disposition |
| --- | --- | --- | --- |
| R1 | Existing legacy secure downloads and fulfillment require a repository-generated delivery mapping. | `functions/_lib/download-route.mjs` and `functions/_lib/order-fulfillment.mjs` call `getDeliveryProduct`; `functions/_lib/product-delivery.mjs` derives the mapping from `shared/runtime-catalog.mjs`. The current catalog is empty. | Authorize legacy delivery from the signed credential, paid D1 order, active D1 entitlement, and the entitlement's stored R2 key/filename/content type. Remove the generated-catalog gate. Preserve all authorization and exact-order/entitlement checks. |
| R2 | The two retained staging Agency entitlements reference an R2 object that is absent from `trg-products-staging`. | D1 records expect `agency/product.pdf` at 9,630,946 bytes; an exact Wrangler R2 read returned key-not-found. | Before claiming staging continuity, restore the approved Agency PDF to the staging key from an authorized source and verify size, content type, and digest. Do not copy from or modify production without separate authority. If no approved source is available, Task 2R-B must stop and report this exact blocker. |

R1 is the only remaining code-level marketplace runtime blocker. R2 is a staging-data blocker needed to prove the cutover.

### 2. Legacy migration blockers

| ID | Finding | Executable consumers | Required disposition |
| --- | --- | --- | --- |
| L1 | Cart identity and authoritative pricing retain a legacy fallback to `shared/runtime-catalog.mjs`. | `functions/_lib/cart-catalog.mjs`, `cart-quote.mjs`, `cart-checkout.mjs`, `orders-pending.mjs`, and `native-order-preparation.mjs`. | Make D1 the only runtime product source. Retired or missing D1 products must fail closed; never fall back to a conflicting generated record. |
| L2 | Anonymous legacy free downloads use both generated runtime catalog and generated folder map. | `functions/_lib/free-download.mjs`. | Retire the legacy anonymous path or resolve only eligible D1 products through the authenticated native free-acquisition/library path. Do not derive R2 keys from slugs or folders. |
| L3 | Creator Balance legacy purchase checks and legacy fulfillment derive delivery keys from generated product data. | `functions/_lib/creator-balance-route.mjs`, `product-delivery.mjs`, and `order-fulfillment.mjs`. | Reject retired legacy products for new purchases and use native D1 product snapshots for any supported future Creator Balance purchase. Existing legacy entitlements remain readable from D1 snapshots. |
| L4 | My Library overlays current legacy title/version/cover from the generated runtime catalog. | `functions/_lib/account-library.mjs`. | Use immutable order-item snapshots for legacy purchase history. Optionally enrich from a D1 product record, but never require live catalog data for ownership or download. |
| L5 | Product inactivity falls back to the generated catalog when no D1 product exists. | `functions/_lib/product-inactivity.mjs`. | Resolve catalog state only from D1. A listing with no D1 product must fail closed and remain nonpublic. |
| L6 | Owner Pricing downloads `data/products.json` to show legacy-only read-only identities. | `assets/js/owner-pricing-editor.js`. | List only D1 products from the authenticated Owner API after the Agency identity is represented in D1. Remove the static fetch and legacy-only UI branch. |
| L7 | Owner Intake edit/related-product discovery downloads `data/products.json` and `data/product-intake-map.json`. | `assets/js/product-intake.js`. | Load native products from an authenticated D1-backed endpoint. Preserve the current create-only publication endpoint and do not turn intake into an overwrite path. |
| L8 | Homepage hydration can preserve repository-rendered product cards beside D1 products. | `assets/js/homepage-shelves.js` reads existing product markup; `scripts/build-store.js` still generates catalog/product/homepage markup from `data/products.json`; Owner Homepage reports a repository-rendered fallback. | Remove static-product merge behavior after migration. D1 shelves must be complete and authoritative; static shelf structure and locked artwork may remain build-time assets. |
| L9 | A disabled Owner publication endpoint still imports the generated folder map to distinguish “existing” products. | `functions/owner/api/publish.js` -> `functions/_lib/owner-publish.mjs` -> `shared/product-folder-map.mjs`. | Remove the retired endpoint or reduce it to an explicit unavailable response with no catalog imports. The active `/owner/api/catalog-publication` endpoint remains intact. |
| L10 | Agency has stable historical identity and ownership but no D1 product row. | Six legacy order items and two active legacy entitlements use slug `agency`; `marketplace_products` has zero rows. | Insert one nonpublic D1 identity for Agency without altering order or entitlement snapshots. See the migration map below. |

These branches do not currently expose an active legacy product because the generated catalog is empty. They remain blockers because they are executable compatibility paths that would require repository data/redeployment and because R1 affects retained purchases now.

### 3. Development-only GitHub use

| Finding | Disposition |
| --- | --- |
| Git repository metadata in `package.json` and dependency funding URLs in `package-lock.json`. | Acceptable source-development metadata. |
| Git itself, commit history, branches, and Cloudflare's deployment/source integration. | Acceptable development, CI, and deployment use. No business transaction invokes it. |
| `.github/workflows` exists with no workflow files at this checkpoint. | No operational workflow remains. |
| Test assertions that scan for GitHub dispatch/API/token regressions. | Retain as development safeguards. |

### 4. Dead or retired code

| Finding | Disposition |
| --- | --- |
| `scripts/publish-intake.js` still contains repository mutation transformers, but its CLI exits with the retired-publication error. | Retain only if needed as migration reference; otherwise delete after Task 2R-B tests no longer import it. It must never be re-enabled operationally. |
| `scripts/sync-r2-products.js` is read-only and rejects its former build/report mutation modes. | Development/migration reference only; remove when legacy migration work is complete. |
| `shared/homepage-product-catalog.mjs` is generated but has no runtime importer. | Delete after confirming no build/test contract requires it. |
| `data/homepage.json` is used only by retired `publish-intake.js` and legacy tests. | Remove from operational build inputs after the compatibility tests are retired. |
| Old Creator tests still supply mock `GITHUB_*` variables (`test-creator-active-shelf-slots.js`, `test-creator-product-withdrawal.js`, `test-creator-publishing-end-to-end.js`, `test-product-inactivity-shelf-expiration.js`). | Remove obsolete mock variables or retire the old harnesses; they do not reach runtime code. |
| `test:legacy-catalog-publication` asserts an obsolete direct mapping from an approved listing without the accepted R2 object references now required by native review. | Replace with native migration/cutover regression coverage. The current standalone harness fails at line 130 and is not part of `npm test`. Do not weaken native asset validation to make it pass. |

### 5. Unrelated feature gaps

The following do not prevent GitHub severance and should not be folded into Task 2R-B:

- the staging-only guest preview JSON and pages under `/guest/preview-products/`; they are explicitly non-purchasable visual fixtures, not marketplace records;
- mixed legacy/native carts, because no active legacy product remains and Agency should be migrated nonpublic;
- a real Stripe-hosted guest checkout and real Resend delivery test, already carried as the Task 2P-B limitation;
- refunds, royalties, payouts, accounting, ZIP conversion, profile work, Shelved work, and storefront redesign;
- promoting the reconstruction branch to the shared staging or production deployment aliases.

## Precise Agency migration map

### Source facts

Use only facts supported by current D1 snapshots and the final repository record immediately before catalog clear:

- stable slug: `agency`;
- proposed deterministic D1 ID: `legacy:agency`;
- Creator: `creator-rv-sawyer` (`RV Sawyer`);
- title: `Agency`;
- subtitle: `Share the wheel or crash the game`;
- publisher: `Tobacco Road Games`;
- system: `System Agnotic` (preserve historical text; do not silently rewrite content in the Severance migration);
- product line/series: `Tablecraft`;
- media type: `digital`;
- version: `1.0`;
- historical release/last-update date: `2026-06-24`;
- cover key, if independently verified to exist: `agency/cover.webp`;
- delivery key: `agency/product.pdf` only after the approved object exists and is verified;
- delivery filename/type: `Agency.pdf` / `application/pdf`;
- historical purchase snapshots remain 400-cent list / 300-cent selected USD and must not be rewritten.

The repository deliberately removed Agency from the launch catalog. Therefore the migration must default to:

- `publication_state = 'retired'`;
- `status = 'legacy-not-for-sale'`;
- `buy_mode = 'retired'`;
- `creator_listing_id = NULL` (migration 054 intentionally removed the old seeded listing; do not resurrect it);
- nonpublic metadata noting the legacy source and migration version.

Do not infer a currently sellable price from old paid orders. The last pre-clear repository record changed Agency to free, while purchase snapshots reflect an earlier $4.00 list / $3.00 paid configuration. A future decision to republish Agency requires explicit Owner action through native controls and is not part of Severance.

### Idempotency and collision rules

Task 2R-B should implement a single, dedicated migration/cutover checkpoint with these guards:

1. Assert the target database name and UUID are staging and `store_state` is `CLOSED`.
2. Inspect all pending migrations; apply only the new Severance migration.
3. Abort if slug `agency` exists with an ID other than `legacy:agency`, or if ID `legacy:agency` exists with another slug.
4. Insert only when neither identity exists. If the exact ID/slug/Creator tuple already exists, verify all immutable fields and treat the retry as success.
5. Never update existing order-item price/title/version snapshots.
6. Never replace, duplicate, or delete existing `download_entitlements` rows.
7. Never synthesize an R2 object. Verify the approved object before storing a delivery key.
8. Record a migration audit marker in D1 or make the exact product row itself the idempotency marker; use one atomic D1 batch for related writes.
9. Confirm the record remains nonpublic and cannot be quoted or purchased.

### Ownership and download continuity

Keep legacy orders and `download_entitlements` as legacy rows. They already contain the purchase-time and delivery snapshots needed for durable ownership. Do not convert them to `native_product_entitlements`, because doing so would require inventing native order revisions and payment-state fields after the fact.

The secure legacy download route should:

1. verify the signed credential;
2. load the exact active entitlement by entitlement/order/order-item/product tuple;
3. verify the parent order is paid and the order item matches;
4. read the entitlement's stored R2 key, filename, and content type;
5. stream only that exact private object;
6. retain existing download audit behavior;
7. expose none of those private fields in browser-facing JSON.

This removes the generated-catalog dependency while preserving “Buying is Owning.” Product repricing, retirement, or absence from public discovery must not revoke the two purchases.

## Minimum Task 2R-B sequence

1. Add the guarded Agency D1 identity migration and targeted migration tests, but do not apply it until the staging R2 source issue is resolved or explicitly documented as the completion blocker.
2. Cut legacy secure download/fulfillment authorization over to D1 entitlement snapshots and add tests for exact-key authorization, manipulated credentials, unpaid orders, missing objects, and retained access after product retirement.
3. Remove generated-catalog fallback from cart, quote, checkout, native order preparation, Creator Balance, account library, inactivity, Owner Pricing, Owner Intake discovery, homepage hydration, and the disabled Owner publish endpoint.
4. Stop generating or shipping runtime product records from `data/products.json`; preserve only static shell/artwork generation. Do not alter locked storefront artwork or its visual baselines.
5. Replace/retire legacy harnesses with D1 migration and continuity tests.
6. Apply only the intended migration to staging after verifying pending migrations and `CLOSED` before and after.
7. Verify Agency remains nonpublic/unquotable, existing entitlement access succeeds when the approved R2 object exists, retries do not duplicate rows, and stale/conflicting identities fail closed.
8. Run the full requested suite and a repository-wide executable-runtime scan. The required final result is zero imports/fetches of generated product catalogs in marketplace runtime and zero GitHub operational calls.

If the Agency staging PDF cannot be restored from an authorized source, Task 2R-B can still remove the code dependency and commit the migration, but it must stop under completion condition B and report that exact R2 continuity blocker rather than claim successful staging delivery.

## Verification performed

### Passed

- `npm run test:operation-severance`
- `npm run test:product-catalog-d1`
- `npm run test:native-d1-orders`
- `npm run test:native-d1-entitlements`
- `npm run test:native-d1-delivery`
- full `npm test`
- `npm run build:pages`
- `npm run test:pages-build`
- Wrangler 4.156.2 Pages Functions compilation
- repository-wide executable GitHub API/dispatch/token scan: zero runtime matches
- read-only staging D1 inventory and migration check
- read-only latest-code staging preview requests
- staging remained `CLOSED`

### Known failure

- `npm run test:legacy-catalog-publication` fails at `scripts/test-legacy-catalog-publication.js:130` because the obsolete harness expects an approved listing with placeholder file rows to map as valid publication. Native publication now correctly requires accepted assets with explicit object references. The script is not part of `npm test`; Task 2R-B should replace it with native legacy-migration coverage rather than weakening validation.

## Final status

- GitHub operational API/dispatch dependency: **zero**.
- Repository-generated product data in executable compatibility paths: **still present**.
- Active public legacy catalog products: **zero**.
- Legacy identities requiring continuity migration: **Agency only**.
- Existing legacy ownership records: **two active Agency entitlements in staging D1**.
- Staging legacy delivery object: **missing**.
- Operation Severance complete: **no**; Task 2R-B is required for the narrow legacy cutover and continuity proof.
