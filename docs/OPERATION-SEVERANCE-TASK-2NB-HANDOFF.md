# Operation Severance Task 2N-B Handoff

## Result

The existing Owner Homepage Editor now reads and writes an authoritative,
revision-controlled homepage configuration in Cloudflare D1. Native product
selection, shelf ordering, shelf visibility, and Featured Creator placement are
available through the authenticated Owner website. Public homepage shelves read
the saved configuration and current public product records at request time, so
changes appear without a repository edit, GitHub operation, generated homepage
file, rebuild, or redeployment.

## D1 configuration and Owner workflow

- Migration `063_homepage_configuration.sql` creates the singleton
  `homepage_configurations` record. The complete validated JSON document and its
  revision are updated atomically.
- The document separates merchandising from product records and stores stable
  product and Creator IDs. It preserves shelf visibility, automatic/manual
  behavior, ordered selections, Featured Creator identity, and validated
  promotion records and links.
- `GET /owner/api/homepage` requires the existing Owner or Administrator
  session. It returns the authoritative configuration, revision, current
  eligibility sets, Owner-safe product records, eligible Creators, and the
  session CSRF token. It does not return private R2 references.
- `POST /owner/api/homepage` additionally requires same-origin and CSRF
  validation. It accepts only the expected revision and shelf configuration,
  preserves promotion data outside this editor, validates all product and
  Creator references against current D1 eligibility, and commits only after the
  optimistic revision check succeeds.
- A stale update returns `409 revision_conflict` and the current authoritative
  configuration. The editor refreshes rather than overwriting the newer record.
- Paused, unpublished, retired, unlisted, or Creator-ineligible native products
  are excluded from public shelves. Their configured slugs are suppressed so a
  conflicting legacy record cannot reappear in the same managed shelf.

## Public homepage compatibility

- `/api/homepage-shelves` returns all four configured shelf payloads with
  current D1 product title, Creator, pricing label, cover URL, and public detail
  URL.
- `_routes.json` now explicitly routes `/api/homepage-shelves` through Pages
  Functions. Live staging caught and verified this deployment requirement.
- The existing homepage geometry and Bright/Dark presentation remain unchanged.
  The client replaces only product books inside the existing shelf bays.
- Native products win identity conflicts. Existing pre-rendered legacy products
  remain as the migration fallback and are merged behind native selections.
- All RV-locked storefront artwork and geometry tests remain unchanged and pass.

## Authenticated staging verification

Target:

- D1: `trg-orders-staging`
- D1 UUID: `d92594e8-a45c-4f84-8f48-7c3aeba17f29`
- R2: `trg-products-staging`
- Pages deployment: `01ad7f68.tobacco-road-games-staging.pages.dev`
- Branch alias: `task2nb-homepage.tobacco-road-games-staging.pages.dev`

Migration 063 was applied directly to the verified staging database and recorded
in `d1_migrations`. The blanket migration command was deliberately not used
because staging still has the older `052_open_store_state.sql` pending; applying
the entire queue would have violated the CLOSED-store boundary. Migration 052
remains unapplied and `store_state` remained `CLOSED` throughout.

The reproducible Chromium test in
`scripts/test-owner-homepage-native-staging.js` exercised the deployed
`/owner/homepage.html` page with a disposable authenticated Owner session:

1. Published two disposable native products through the Cloudflare publication
   endpoint and verified their D1 records and private R2 files.
2. Loaded the actual Owner Homepage Editor at authoritative revision 1.
3. Selected Alpha then Bravo for New This Week and saved revision 2.
4. Opened the public homepage and verified the exact visual order, current D1
   title, Creator, `$6.50` price, detail URL, public WebP cover, and absence of
   private delivery references without another build or deployment.
5. Used the editor's Move Earlier control to place Bravo before Alpha. The
   public homepage reflected revision 3 immediately.
6. Created a concurrent D1 update, submitted the now-stale browser revision,
   and confirmed the conflict message with no overwrite.
7. Paused Alpha and confirmed it disappeared from the public shelf while Bravo
   remained active. A direct attempt to pin the paused product returned
   `409 ineligible_product`.
8. Confirmed an unauthenticated modification returned `401`.
9. Removed both selections through the editor and confirmed they disappeared
   immediately while all four existing homepage shelf bays remained functional.
10. Restored the original `homepage_configurations` row byte-for-byte, including
    its JSON, revision, and timestamps.
11. Removed both product records, the exact cover/PDF R2 objects, and the Owner
    session. Final queries returned zero Task 2N-B products and sessions.
12. Confirmed both R2 object lookups failed after cleanup and staging remained
    `CLOSED`.

Production was not queried, modified, built, merged, or deployed.

## Automated verification

- `node scripts/test-owner-homepage-d1.js` — passed
- `node scripts/test-owner-homepage-editor.js` — passed
- `node scripts/test-homepage-shelves.js` — passed
- Operation Severance, public catalog, Owner Intake, and Owner Pricing targeted
  regressions — passed
- `npm test` — passed
- `npm run build:pages` — passed; 218 allowlisted Pages files prepared
- `wrangler pages functions build functions` — passed
- `npm run test:storefront-visual` — passed with all locked baselines unchanged
- Authenticated native staging browser verification — passed

## Changed files

- `_routes.json`
- `assets/js/homepage-shelves.js`
- `assets/js/owner-homepage-editor.js`
- `functions/_lib/homepage-config-d1.mjs`
- `functions/_lib/homepage-shelves.mjs`
- `functions/_lib/owner-homepage-publish.mjs`
- `functions/_lib/public-product-catalog.mjs`
- `functions/owner/api/homepage.js`
- `migrations/063_homepage_configuration.sql`
- `owner/homepage.html`
- `index.html`
- `guest/index.html`
- `scripts/build-store.js`
- `scripts/test-homepage-shelves.js`
- `scripts/test-operation-severance.js`
- `scripts/test-owner-homepage-d1.js`
- `scripts/test-owner-homepage-editor.js`
- `scripts/test-owner-homepage-native-staging.js`
- `package.json`
- `docs/OPERATION-SEVERANCE-TASK-2NB-HANDOFF.md`

## Remaining limitations

- Legacy-only repository catalog entries remain a read-only, pre-rendered
  compatibility fallback until they are migrated into D1.
- Promotion records and safe links are preserved and validated in the D1
  document, but the prior Homepage Editor did not provide promotion controls;
  Task 2N-B does not add a new promotional feature.
- The Task 2H limitation remains: no real Stripe-hosted Checkout Session was
  completed during this task.
