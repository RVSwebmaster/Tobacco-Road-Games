# C2B Implementation Report — Express Dashboard and CSV Formula Protection

Date: 2026-11-18

## Stripe Express Dashboard

- Added `createConnectDashboardLoginLink()` to `functions/_lib/stripe-connect-sandbox.mjs`. It makes a fresh POST to `/v1/accounts/{connected_account_id}/login_links`, validates the account identifier and the returned HTTPS Express URL, and returns only the URL value.
- Extended the existing authenticated `POST /api/creator/connect` action with `action: "dashboard"`. It uses the current session, same-origin and CSRF checks, and Creator-manager membership lookup before selecting the connected account from that Creator's own payout profile. A caller cannot supply or override an account ID. Profiles without an existing Stripe Connect account are rejected.
- Added the Creator Dashboard button. It is only shown where the selected Creator has a Stripe Connect account. Clicking requests a new login link and immediately redirects to Stripe. The button is disabled while the request is pending.
- Login links are returned with `Cache-Control: private, no-store`; the application does not persist or log the URL. The audit record contains only Creator, actor, action, and connected account reference.
- The existing sandbox restriction remains in effect: the helper requires a Stripe test secret and refuses `PAYMENT_PIPELINE_STAGE=production`. This work does not enable production account access, payments, transfers, or payout execution.
- Stripe reference: [Integrate the Express Dashboard](https://docs.stripe.com/connect/integrate-express-dashboard), which describes generating account-specific links on demand and redirecting only from within the platform.

## Financial CSV protection

- Added shared `functions/_lib/financial-csv.mjs`, adapting Papa Parse's `escapeFormulae` prefix behavior and standard CSV quoting. Formula-leading text is prefixed with an apostrophe before normal quoting; numbers and BigInts are serialized without formula escaping, preserving negative financial values.
- Applied it to both existing Creator financial exports: `statementCsv()` in `functions/_lib/creator-finance.mjs` and `creatorBusinessReportCsv()` in `functions/_lib/creator-business-report.mjs`.
- Repository inspection found no Owner financial CSV endpoint or exporter. The Owner finance UI/API currently returns authenticated financial data as JSON. No new Owner export capability was added as part of a protection-only change. Any separately authorized Owner CSV exporter should use the shared serializer.

## Focused tests

`scripts/test-c2b-express-dashboard-and-csv.js` verifies formula characters, whitespace-prefixed formula input, CR quoting, comma/quote formatting, unmodified positive and negative integer financial fields, both Creator export serializers, same-Creator authorization, cross-Creator denial before provider calls, CSRF denial, Stripe account-specific POST behavior, no-store response, omission of the one-time URL from audit persistence, URL host validation, and retained test-mode/production guards. The test is included in `npm run verify:launch` as an independent focused regression.

## Verification

`node scripts/test-c2b-express-dashboard-and-csv.js`, `node scripts/test-marketplace-pass9.js`, and `node scripts/test-marketplace-pass14.js` passed before the full gate. Final `npm run verify:launch` outcome and counts are recorded in `docs/LAUNCH-VERIFICATION-RESULT.json`.

No production access, live financial operations, transfers, deployment, dependency installation, or commits occurred. Existing C2D work and unrelated uncommitted files were preserved.

### Final launch verification — 2026-11-18

`npm run verify:launch` completed with outcome **PASS_WITH_SEPARATE_CHECKS_PENDING** and launch-critical outcome **PASS**: **70 passed, 0 failed, 0 skipped, 1 blocked**. The blocked check is the remote-only `npm run test:creator-native-submission-staging`, requiring remote staging D1/R2 and Wrangler configuration. Separate storefront visual and Owner-intake Chromium checks passed. Tested revision `8931f6018f8ca800481488dac9cd708c1047dde9`; the working tree was dirty. Full results: `docs/LAUNCH-VERIFICATION-RESULT.json`.
