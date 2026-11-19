# Operation Severance Task 2O-A Handoff

Task 2O-A restores the existing Creator product submission workflow on Cloudflare staging without restoring any GitHub operational role.

## Implemented

- The existing `/creator/` dashboard now captures complete descriptions and fixed, free, or Pay What You Want pricing, including explicit PWYW minimum and suggested amounts.
- Creator listing metadata remains in `creator_listings`; migration `064_creator_native_submission_pricing.sql` adds the previously missing Creator PWYW minimum column.
- Creator PDF and WebP uploads continue to use the authenticated `/api/creator/listings/:id/files` route and the private `TRG_PRODUCTS` R2 binding.
- R2 writes are create-only. A D1 commit failure removes only the object owned by that upload attempt, preventing a failed upload from leaving an orphaned file.
- Submission now requires complete metadata, valid pricing, a private WebP cover, and (for digital or hybrid products) a private PDF before entering review.
- A successful Creator submission remains `lifecycle_state='submitted'` and `publication_state='not_approved'`. It does not create a `marketplace_products` row and is invisible to the public D1 catalog.
- Existing Creator authentication, same-origin and CSRF verification, membership permissions, operational eligibility, catalog-tier limits, declarations, and Owner review decisions remain in use.
- The native Owner catalog-publication endpoint rejects an authenticated Creator session with HTTP 403.
- Existing Owner compliance review remains separate from publication. Reconstructing approved Creator publication into the native `marketplace_products` catalog remains Task 2O-B.

## Staging evidence

- Pages project: `tobacco-road-games-staging`
- Isolated deployment: `8ae06a0c.tobacco-road-games-staging.pages.dev`
- Branch alias: `task2oa-creator-submission.tobacco-road-games-staging.pages.dev`
- D1 database: `trg-orders-staging`
- D1 UUID: `d92594e8-a45c-4f84-8f48-7c3aeba17f29`
- R2 bucket: `trg-products-staging`
- Applied migration: `064_creator_native_submission_pricing.sql`
- Unrelated store-opening migration `052_open_store_state.sql` remained unapplied.
- Store state before and after verification: `CLOSED`.

The authenticated browser test used the actual Creator dashboard to create a fixed-price draft, reject an invalid file, upload a PDF and WebP, and submit the listing for review. D1 contained the complete metadata and two private quarantine references; the exact R2 bytes matched the submitted files. The public catalog returned 404 for the unapproved slug.

The same browser run verified free and PWYW entry and validation, duplicate submission rejection, Creator denial at the privileged Owner publication endpoint, Standard Creator capacity (20 active / 1 PWYW), and visibility through the existing Owner review interface using a separate authenticated Owner identity.

All disposable listings, declarations, review and publication audit rows, files, Creator and Owner identities, sessions, and exact R2 objects were removed. No production resource was touched.

## Verification

- `npm run test:creator-native-submission` — passed.
- `npm test` — passed.
- `npm run build:pages` — passed (218 allowlisted files).
- `npm run test:pages-build` — passed.
- Pages Functions compilation — passed with Wrangler 4.156.1.
- `npm run test:storefront-visual` — passed; no locked storefront baseline changed.
- `scripts/test-creator-native-submission-staging.js` against the isolated staging deployment — passed with cleanup confirmed.

Several optional legacy Creator scripts still encode the retired GitHub-dispatch publication success path and are intentionally not acceptance tests for Task 2O-A. Where sampled, those scripts stopped at the severance-era unavailable response or at the new complete-submission gate rather than restoring GitHub behavior.

## Task 2O-B dependency

Owner review can approve, reject, or request changes, but an approved Creator listing is not copied into the authoritative native `marketplace_products` table by Task 2O-A. Task 2O-B must map the approved immutable Creator listing and accepted private files into the Cloudflare-native publication transaction, retaining create-only R2 handling and explicit Owner authorization. Approval must remain distinct from public publication.

### Capacity policy supersession — C3 (2026-11-18)

This handoff's Standard 20 active / 1 PWYW note is historical. Current approved catalog/shelf allocations are Standard 12/6, Founding-25 and Premier 24/12, Admin unlimited/unlimited, and Owner unlimited/14. Existing customer entitlements and downgrade continuity remain unchanged.
