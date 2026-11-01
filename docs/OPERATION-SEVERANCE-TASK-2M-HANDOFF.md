# Operation Severance Task 2M Handoff

## Result

The existing Owner Product Intake workbench now creates native products through
`/owner/api/catalog-publication`. It sends validated metadata, a WebP cover, and
a PDF with the existing Owner session and CSRF protections. Publication success
is shown only after the endpoint has verified both private R2 objects and the
published D1 record.

No GitHub workflow, repository catalog update, or redeployment is part of an
Owner publication transaction.

## Native mapping and behavior

- New products use their stable slug as the D1 product ID and slug.
- Owner Intake publications use the established `creator-rv-sawyer` ownership
  identity.
- Fixed, free, and PWYW pricing map to the authoritative D1 pricing fields.
  PWYW suggested and minimum amounts remain explicit; no price is invented.
- Existing intake metadata that is not an authoritative product column is
  retained in `metadata_json`.
- The server assigns unique `catalog-publications/<attempt-id>/...` R2 keys,
  uses create-only writes, verifies the stored bytes and metadata, and records
  the exact keys in D1.
- Duplicate products and asset collisions fail without overwriting records or
  objects. Failed publication removes only objects owned by that attempt.
- The interface displays the published product ID, slug, and actual public URL.
- The Check and Review controls remain functional for `available-direct`, free,
  and PWYW listings.
- The native endpoint is create-only. The existing-listing mode remains useful
  for inspection, but the interface explicitly blocks an existing-listing
  publish request instead of implying that an update succeeded.

## Staging browser verification

Target:

- D1: `trg-orders-staging`
- D1 UUID: `d92594e8-a45c-4f84-8f48-7c3aeba17f29`
- R2: `trg-products-staging`
- Pages deployment: `2527a962.tobacco-road-games-staging.pages.dev`
- Branch alias: `task2m-owner-intake.tobacco-road-games-staging.pages.dev`

The reproducible Chromium test in
`scripts/test-owner-intake-native-staging.js` used the deployed
`/owner/product-intake.html` interface with a disposable authenticated Owner
session. It performed these checks against native bindings:

1. Entered and validated a complete fixed-price listing in the actual UI.
2. Uploaded a WebP cover and PDF through the UI and published the product.
3. Confirmed the UI reported the real product ID, slug, and storefront URL only
   after the request completed.
4. Read the product through the D1 catalog module and confirmed Creator,
   publication state, availability, fixed pricing, and explicit R2 keys.
5. Downloaded both exact private R2 objects administratively and compared their
   bytes to the uploaded fixtures.
6. Opened the deployed public product page and confirmed title, description,
   Creator, `$6.25` price, and public WebP cover without another build or deploy.
7. Confirmed `/product-assets/<slug>/delivery.pdf` returned 404 and no private
   delivery key appeared in the public page.
8. Repeated the UI submission and confirmed the duplicate failed without
   replacing the D1 record or either R2 object.
9. Submitted invalid WebP bytes and confirmed server validation failed with no
   D1 product.
10. Confirmed the actual UI accepted valid fixed, free, and zero-minimum PWYW
    configurations with explicit amounts.
11. Removed the disposable D1 product, both exact R2 objects, and the Owner
    session. A final query returned zero Task 2M products and sessions, and the
    exact R2 lookups failed as expected.
12. Confirmed staging began and ended with `store_state=CLOSED`.

An initial verification run completed all functional checks but encountered a
Windows Chromium-profile file lock after removing the product and R2 objects.
The disposable session was then removed explicitly, the cleanup helper was made
retry-safe, and the complete browser verification was rerun successfully with a
zero exit status and full cleanup.

Production was not queried, modified, built, merged, or deployed.

## Automated verification

- `node scripts/test-owner-intake-ui.js` — passed
- `node scripts/test-owner-intake.js` — passed
- `node scripts/test-product-publication.js` — passed
- `npm run test:owner-intake-browser` — passed in Chromium
- `npm test` — passed
- `npm run test:storefront-visual` — passed; locked storefront artwork and
  layout baselines are unchanged
- `npm run build:pages` — passed; 218 allowlisted Pages files prepared
- `wrangler pages functions build functions --outdir .wrangler/task2m-functions-build`
  — passed
- Authenticated native staging browser verification — passed

## Changed files

- `assets/js/product-intake.js`
- `owner/product-intake.html`
- `functions/_lib/product-publication.mjs`
- `scripts/test-owner-intake-ui.js`
- `scripts/test-product-publication.js`
- `scripts/test-owner-intake-native-staging.js`
- `package.json`
- `docs/OPERATION-SEVERANCE-TASK-2M-HANDOFF.md`

## Remaining limitations

- Updating an already-published native product from Owner Intake is not part of
  the create-only publication endpoint and remains unavailable.
- Creator-facing publication remains outside Task 2M.
- The outstanding Task 2H limitation remains: no claim is made that a real
  Stripe-hosted Checkout Session was completed.
