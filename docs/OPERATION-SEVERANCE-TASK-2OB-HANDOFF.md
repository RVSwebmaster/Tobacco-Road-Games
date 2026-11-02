# Operation Severance Task 2O-B Handoff

## Checkpoint

- Branch: `codex/operation-severance-task1`
- Starting commit: `18d2cd3835079de851f409bb11f3d30c91d8727d`
- Environment verified: Cloudflare staging only
- D1: `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`)
- R2: `trg-products-staging`
- Isolated Pages deployment: `https://3fbcd191.tobacco-road-games-staging.pages.dev`
- Production: untouched

## Native approval architecture

The Owner review route now requires an authenticated Owner/Admin account and same-origin CSRF verification. File decisions and review decisions require the current Creator-listing revision.

Approval performs these operations:

1. Revalidates the Creator's current operational eligibility, registration, account state, publication capacity, product metadata, pricing, declarations, and review hold.
2. Requires accepted WebP cover and PDF file records.
3. Verifies both accepted objects through the native `TRG_PRODUCTS` R2 binding, including size, content type, listing identity, and purpose metadata.
4. Uses the existing private create-only R2 objects; approval does not buffer, copy, overwrite, or delete product files.
5. Atomically moves the Creator listing through `publishing`, inserts the authoritative `marketplace_products` record, records the private delivery reference, updates the listing to `published`, and writes review/publication audits in one D1 batch.
6. The migration trigger binds the catalog insert to the expected listing revision, so a stale or conflicting transition aborts the complete D1 batch.

Rejected and change-requested products remain outside `marketplace_products` and therefore remain unavailable to public catalog, asset, cart, and purchase paths.

## Migration

`065_creator_native_review_publication.sql` adds:

- `creator_listings.revision`, initialized to 1.
- `require_creator_listing_publication_transition`, which prevents a native Creator product insert unless the linked submission is in the matching revision-controlled `publishing` transition.

Migration 065 was applied successfully to staging.

Wrangler also discovered and applied the previously skipped `052_open_store_state.sql` in the same non-interactive migration run. That migration set staging to `OPEN`; the run was immediately followed by an explicit safety restoration to `CLOSED`. The final independent query confirmed `store_state=CLOSED`, updated by `task2ob-safety-restore`. Migration 052 is now recorded as applied, preventing a future migration run from reopening staging.

## Authenticated staging evidence

The actual Creator dashboard and Owner review page were exercised in headless Chromium against the isolated Pages deployment:

- Eligible Creator created a fixed-price product in the UI.
- Invalid upload was rejected; valid PDF and WebP were stored in private R2.
- Creator submitted the product through the UI; it remained absent from the public catalog.
- Authenticated Owner opened `/owner/creator-reviews.html` and saw full metadata, pricing, Creator identity, filenames, types, sizes, and review states.
- Owner accepted both files through the UI.
- A stale approval returned 409.
- The Creator's attempted self-approval returned 403.
- Owner clicked **Approve & Publish**; D1 moved the listing to `published` and created one public product.
- The public catalog, storefront detail, price, Creator attribution, and WebP cover appeared immediately without another deployment.
- Public JSON did not expose private R2 keys, and the public asset route served only the cover.
- A duplicate approval returned 409 and did not create a second product.
- A second Creator submission was rejected through the Owner UI and remained a public 404.
- The Creator dashboard showed the published and rejected decisions.

## Cleanup

- The published disposable product was first made nonpublic and removed from D1.
- All disposable Creator listings, file rows, declarations, audits, identities, sessions, account rows, and Creator records were deleted.
- Every exact disposable R2 object was deleted and verified absent.
- Independent final counts: users 0, Creators 0, listings 0, products 0 for Task 2O-A/2O-B prefixes.
- Staging store state: `CLOSED`.

## Verification

- `npm run test:creator-native-submission` — passed.
- `npm run test:creator-product-publication-sandbox` — passed.
- `npm run test:creator-native-review-publication` — passed.
- `npm test` — passed.
- `npm run build:pages` — passed (218 allowlisted files).
- `wrangler pages functions build functions --outdir .wrangler/task2ob-functions-build` — compiled successfully.
- `npm run test:storefront-visual` — passed; no locked storefront baseline changed.
- Runtime GitHub dispatch/API/environment scan — no matches.
- Authenticated live staging browser workflow — passed.

## Remaining boundaries

- Creator bundles and Creator publication pause still return the explicit temporary-unavailable response; they were not reconstructed in Task 2O-B.
- No notification-email workflow was added.
- No production deployment or branch merge occurred.
- No Stripe, checkout, entitlement, download, library, accounting, Creator profile, reputation, or ZIP behavior was changed.
