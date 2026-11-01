# Operation Severance Task 2N-A Handoff

## Result

The existing Owner Pricing interface now reads and updates authoritative native
products through Cloudflare D1. Fixed, free, and Pay What You Want pricing and
available/paused storefront state are revision checked and validated on the
server. Successful changes are immediately visible to D1 storefront and cart
consumers without GitHub, generated catalog changes, or redeployment.

## Owner workflow

- `GET /owner/api/pricing` requires an authenticated Owner or Administrator and
  returns owner-safe native product pricing records, current revisions, and the
  session CSRF token. Private R2 keys are never returned.
- The interface merges native products with the generated legacy catalog only
  for migration visibility. Native D1 identities win slug conflicts. Legacy-only
  entries are labeled and remain read-only.
- `POST /owner/api/pricing` requires the existing Owner session, same-origin
  request validation, and CSRF token.
- The request includes the product slug and expected D1 revision. A stale
  revision returns `409 revision_conflict` with the current owner-safe product;
  the interface refreshes instead of overwriting it.
- Server validation covers fixed positive prices, explicit free zero pricing,
  PWYW suggested/minimum bounds, currency, fixed-only sales, sale schedules,
  and available/paused state.
- Model changes apply the corresponding authoritative status and buy mode:
  fixed uses `available-direct`/`cart`, free uses
  `free-download`/`free-download`, and PWYW uses
  `pay-what-you-want`/`cart`.
- D1 updates use `updateProduct(..., { expectedRevision })`. Product ID, slug,
  Creator ownership, Creator listing identity, R2 references, and purchase-time
  order/entitlement snapshots are outside the patch.

## Authenticated staging verification

Target:

- D1: `trg-orders-staging`
- D1 UUID: `d92594e8-a45c-4f84-8f48-7c3aeba17f29`
- R2: `trg-products-staging`
- Pages deployment: `32b41179.tobacco-road-games-staging.pages.dev`
- Branch alias: `task2na-owner-pricing.tobacco-road-games-staging.pages.dev`

The reproducible Chromium test in
`scripts/test-owner-pricing-native-staging.js` exercised the deployed
`/owner/pricing.html` page with a disposable authenticated Owner session:

1. Published a disposable fixed-price product through the native publication
   Worker and verified D1/R2 revision 1.
2. Created a disposable paid order snapshot and entitlement through the
   existing signed test-mode webhook path. No real Stripe-hosted checkout or
   charge was used. Staging was returned to `CLOSED` before pricing edits.
3. Loaded the product in the actual Owner Pricing page and confirmed native D1
   source, revision 1, and `$5.00` price.
4. Changed the fixed price to `$7.25`; the UI reported authoritative revision 2.
5. Opened the product storefront page and requested a new cart quote. Both
   returned `$7.25`, and the quote returned catalog revision 2, without another
   build or deployment.
6. Created a concurrent update and submitted the stale browser revision. The
   server returned a conflict, retained the newer `$8.00` record, and the page
   refreshed to revision 4 without overwriting it.
7. Confirmed the UI rejected a zero fixed price.
8. Saved free pricing at revision 5.
9. Confirmed the UI rejected PWYW suggested pricing below its minimum, then
   saved `$5.00` suggested and `$0.00` minimum PWYW pricing at revision 6.
10. Sent an invalid PWYW server request and confirmed `400` with no revision
    change.
11. Paused the product through the UI at revision 7. Its public detail route
    immediately returned 404 and new cart quotes returned `paused_product`.
12. Compared the paid order-item snapshot and entitlement before and after every
    edit. Revision 1, fixed pricing, selected 500 cents, delivery reference, and
    active entitlement state remained unchanged.
13. Removed the entitlement, paid order, webhook event, product, Owner session,
    and both exact R2 objects.

Final staging queries returned:

- `store_state=CLOSED`
- Task 2N-A products: `0`
- Task 2N-A sessions: `0`
- Task 2N-A order items: `0`
- Task 2N-A entitlements: `0`
- Task 2N-A webhook events: `0`

Both exact R2 object lookups failed after cleanup as expected. Production was
not queried, modified, built, merged, or deployed.

## Automated verification

- `node scripts/test-owner-pricing-d1.js` — passed
- `node scripts/test-owner-pricing-editor.js` — passed
- Owner Intake, Operation Severance, D1 cart pricing, and D1 storefront targeted
  regressions — passed
- `npm test` — passed
- `npm run test:storefront-visual` — passed; all locked storefront artwork and
  layout baselines remain unchanged
- `npm run build:pages` — passed; 218 allowlisted Pages files prepared
- `wrangler pages functions build functions --outdir .wrangler/task2na-functions-build`
  — passed
- Authenticated native staging browser verification — passed

## Changed files

- `assets/js/owner-pricing-editor.js`
- `owner/pricing.html`
- `functions/_lib/owner-pricing-publish.mjs`
- `functions/owner/api/pricing.js`
- `scripts/test-owner-pricing-d1.js`
- `scripts/test-owner-pricing-editor.js`
- `scripts/test-owner-pricing-native-staging.js`
- `scripts/test-owner-intake.js`
- `scripts/test-operation-severance.js`
- `package.json`
- `docs/OPERATION-SEVERANCE-TASK-2NA-HANDOFF.md`

## Remaining limitations

- Legacy-only generated catalog products remain read-only until they are migrated
  into D1. They are clearly distinguished from editable native records.
- Draft and retired native products are visible but read-only in this pricing
  tool; publication lifecycle management remains outside Task 2N-A.
- The Task 2H limitation remains: no real Stripe-hosted Checkout Session was
  completed during this task.
