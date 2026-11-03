# Operation Severance Task 2R-C Handoff

Date: 2026-11-03  
Branch: `codex/operation-severance-task1`  
Starting commit: `58f27c71530e4d8830144db91a96601bc2239c3f`  
Staging D1: `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`)  
Staging R2: `trg-products-staging`  
Production writes and deployments: none

## Final determination

**Can Tobacco Road Games now operate its marketplace without GitHub participating in day-to-day marketplace operations? Yes.**

Operation Severance is technically complete. The executable runtime scan remains clear of GitHub API, dispatch, workflow, and publishing-token integration. Agency has one native D1 continuity identity, its authorization path uses D1 plus immutable entitlement snapshots, and the exact historical PDF is present in private staging R2. Ordinary marketplace operations do not require a GitHub operation, repository mutation, generated catalog update, or redeployment.

**Can every historical Agency entitlement currently be fulfilled? The two preserved staging entitlements now have complete, matching D1/R2 delivery data and are fulfillable by the verified native handler.**

The exact binary was restored and downloaded back from staging with a matching SHA-256. Secure-route tests pass for authorized delivery, repeated delivery, altered credentials, substituted object references, unpaid orders, revoked entitlements, unknown entitlements, missing objects, and private-key nondisclosure. No hosted customer download was exercised because Task 2R-C prohibited code deployment and the reconstruction branch was not deployed. Deployment rollout remains separate from technical Severance closure.

## Authoritative asset discovery

Sources searched:

1. Current repository, ignored workspace files, and all Git object history.
2. Canonical local project tree under `C:\Users\rvsaw\Desktop\Dr DM Workshop`.
3. The stale local website tree, read-only, as a possible retained asset source.
4. User Desktop, Documents, Downloads, OneDrive, Pictures, Videos, `.codex`, `.media`, and `.cache` PDF holdings, filtered by Agency naming and the exact historical size.
5. Retained `D:` sources: `D:\TRG`, `D:\TobaccoRoadGames`, and `D:\D recovered`.
6. Staging Office D1 records and all objects in `trg-office-archive-staging`.
7. All existing objects in `trg-products-staging` before recovery.
8. Production R2 `trg-products`, read-only, including the documented key, Agency prefixes, all object keys, and exact-size matches.
9. The Cloudflare account's bucket inventory for any alternate production product bucket.

The repository, Git history, standard user folders, stale tree, staging Office archive, staging products bucket, and production R2 contained no candidate. Production `trg-products` currently contains zero objects, despite July runbooks recording the former object at `trg-products/agency/product.pdf`. No production data was changed.

The authoritative file was recovered from the retained local TRG archive:

- source: `D:\TRG\Agency.pdf`;
- byte-identical retained copies: `D:\TRG\WIP\agency\Agency.pdf` and `D:\TRG\WIP\agency\product.pdf`;
- size: 9,630,946 bytes;
- SHA-256: `c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9`;
- signature/version: `%PDF-1.7`;
- pages: 9;
- creation/modification: June 24, 2026;
- creator metadata: Adobe InDesign 21.3;
- visual identity: TRG Tablecraft cover, `Agency`, subtitle `Share the Wheel or Crash the Game`, by RV Sawyer, with Tobacco Road Games branding;
- legal-page identity: the same title, RV Sawyer authorship, and 2026 Tobacco Road Games ownership.

The three retained files have the same checksum. This matches the historical entitlement filename, key, date, PDF version, and 9,630,946-byte size. No substitute, reconstruction, or regenerated edition was used.

## Staging recovery

The unchanged source bytes were uploaded to private staging R2 at:

- bucket/key: `trg-products-staging/agency/product.pdf`;
- content type: `application/pdf`;
- content disposition: `attachment; filename=Agency.pdf`;
- object size: 9,630,946 bytes;
- R2 ETag: `07d27aec78165028e7167075d5887f0c`;
- R2 last modified: `2026-11-03T12:41:33.356Z`.

The object was downloaded back from staging. Its SHA-256 was exactly `c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9`, matching the source.

Migration `069_agency_asset_recovery.sql` was the only pending migration and was applied only to `trg-orders-staging`. It:

- requires the exact `legacy:agency` identity and retired state;
- rejects a conflicting identity or unexpected revision;
- records the explicit delivery key, filename, content type, size, source classification, and checksum;
- advances the product revision from 1 to 2;
- remains retry-safe for the exact finalized state;
- does not insert, update, or delete orders or entitlements;
- leaves no guard table behind.

Final staging state:

- store state: `CLOSED`;
- Agency product identities: exactly 1;
- Agency orders: exactly 6 (`paid` 2, `failed` 2, `pending` 1, `expired` 1);
- active paid Agency entitlements: exactly 2;
- entitlement key/size: `agency/product.pdf`, 9,630,946 bytes;
- Agency product state: `retired` / `legacy-not-for-sale` / `retired`;
- other historical products published: 0;
- pending migrations: 0.

## Secure delivery

The Task 2R-B handler now requires the finalized 2R-C product marker and exact key, filename, content type, checksum marker, and size before Agency can use its continuity path. It still requires:

- a valid signed credential;
- the exact entitlement/order/order-item/product tuple;
- an active entitlement;
- a paid parent order;
- the exact immutable delivery snapshot;
- a present R2 object with the expected size.

The handler streams the R2 body rather than buffering it, preserves download auditing, and returns private no-store headers without exposing the R2 key. Authorization and delivery regressions all pass. The recovered staging bytes independently match the source checksum.

No hosted browser request was performed because no code deployment was permitted. This is a rollout verification limitation, not a missing binary, ownership, GitHub, or code-path dependency.

## Dormant generated-catalog compatibility paths

The repository still contains compatibility imports in legacy cart/checkout, Creator Balance, anonymous free download, library presentation enrichment, inactivity handling, Owner tool discovery, homepage generation, and disabled Owner publication code.

They are classified as dead/retired compatibility code for later cleanup, not active marketplace dependencies:

- `data/products.json` contains zero products;
- the generated runtime catalog and folder map are empty;
- D1 identity always wins for Agency, including its retired/unavailable state;
- Agency secure delivery and fulfillment explicitly bypass generated mappings;
- My Library uses immutable order snapshots when no generated product exists;
- anonymous legacy free acquisition is disabled unless an internal test-only option is supplied;
- the old Owner publisher returns an explicit unavailable response and cannot publish;
- current native storefront, pricing, orders, entitlements, and delivery use D1/R2.

No executable marketplace operation currently requires these files to complete a business transaction. They should not be removed merely for cleanliness within Severance closure.

## Verification results

Passed:

- `npm run test:agency-legacy-continuity`;
- `npm run test:native-d1-delivery`;
- secure legacy download regression through full `npm test`;
- order and entitlement preservation assertions;
- `npm run test:operation-severance`;
- full `npm test`;
- `npm run build:pages` — 218 allowlisted files;
- `npm run test:pages-build`;
- Wrangler 4.44.0 Pages Functions compilation;
- `npm run test:storefront-visual`;
- runtime GitHub integration scan — zero executable matches;
- exact staging R2 download and SHA-256 comparison;
- final remote D1 counts and `CLOSED` state.

## Repository changes

- `migrations/069_agency_asset_recovery.sql`
- `functions/_lib/legacy-product-continuity.mjs`
- `scripts/test-agency-legacy-continuity.js`
- this handoff

No production D1/R2 object, configuration, deployment, store state, or source branch was changed.
