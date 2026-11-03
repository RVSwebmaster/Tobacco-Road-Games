# Operation Severance Task 2S-A Handoff

Date: November 3, 2026  
Branch: `codex/operation-severance-task1`  
Starting commit: `98e1b7c6d98d17f8eb2047d11466b5e302e73e73`  
Acceptance-fix commit: `11c8566` (`Harden staging marketplace acceptance paths`)  
Environment: Cloudflare staging only; production untouched

## Executive decision

**Operation Severance is technically complete in staging.** No executable marketplace runtime path requires the GitHub API, repository/workflow dispatch, a repository commit, a generated catalog publication, or a storefront redeployment for an ordinary native marketplace operation. The sole legacy continuity blocker, Agency, has one D1 identity and exact private R2 delivery asset; its six historical orders and two active paid entitlements remain intact.

The reconstructed Cloudflare-native Owner and Creator workflows passed current authenticated browser execution against the final-code staging preview. D1/R2 publication, storefront discovery, pricing updates, homepage curation, review decisions, catalog management, public assets, server-authoritative cart quotes, rollback, conflicts, authorization, and cleanup passed while shared staging remained `CLOSED`.

Production rollout is **not** authorized by this result. A real Stripe-hosted test checkout and controlled Resend delivery remain externally unverified because Pages preview deployments have no encrypted preview secrets and the shared staging database was required to remain `CLOSED`. Signed Stripe webhook tests and injected email-provider tests passed; they are not represented as real external transactions.

## Baseline and safety

- Branch and starting commit matched the assignment; the worktree was clean at baseline.
- Staging D1: `trg-orders-staging`, ID `d92594e8-a45c-4f84-8f48-7c3aeba17f29`.
- Staging R2: `trg-products-staging`.
- Pages project: `tobacco-road-games-staging`.
- No D1 migrations were pending or applied during Task 2S-A.
- Shared staging was `CLOSED` before, during, and after every acceptance operation.
- Final D1 audit: one Agency product, six Agency orders, two active paid Agency entitlements, zero disposable Task 2 products, sessions, users, or Creators.
- Final R2 audit: the only object is `agency/product.pdf`, 9,630,946 bytes.
- Pages preview secrets were empty again after the temporary Agency download-signing test secret was deleted.
- No production database, bucket, deployment, secret, configuration, or store state was read-write accessed.

## Acceptance fixes

Commit `11c8566` contains two directly demonstrated acceptance fixes and one staging-test safety improvement:

1. Download credentials now reject invalid and non-canonical base64url encodings. Before the fix, an alternate non-canonical spelling of the same signature bytes was accepted; it did not forge a signature, but it violated strict tamper rejection. A regression case was added and the corrected behavior was verified through the deployed Agency route.
2. Verified guest-email expiry and account-session test clocks now use the request's injected authoritative time where supplied. Runtime behavior still defaults to `Date.now()`. This removed fixture-date dependence from guest checkout, claim, library, and secure-delivery regression paths.
3. The Owner Pricing staging harness gained `TRG_TASK2SA_KEEP_STORE_CLOSED=1`, allowing its authenticated UI, pricing, conflict, availability, storefront, and quote checks to run without temporarily opening shared staging. The historical paid-snapshot subcheck remains available in an isolated environment.

Changed files in the acceptance-fix commit:

- `functions/_lib/account-auth.mjs`
- `functions/_lib/cart-checkout.mjs`
- `functions/_lib/download-authorization.mjs`
- `functions/_lib/native-order-preparation.mjs`
- `functions/_lib/native-stripe-payment.mjs`
- `functions/_lib/transaction-policy.mjs`
- `scripts/test-owner-pricing-native-staging.js`
- `scripts/test-secure-download.js`

## Marketplace acceptance matrix

The status vocabulary is the one required by Task 2S-A. `PASS` means actual current staging execution occurred. `CONDITIONAL` means implementation and regression coverage passed but a required external or transaction-state execution could not safely run under the assignment constraints.

| Workflow | Status | Evidence |
| --- | --- | --- |
| Native D1 product create/read/list/update/revision conflict | PASS | Disposable staging D1 CRUD passed; stale revision rejected; cleanup restored `CLOSED`. |
| Owner native publication | PASS | Actual authenticated Owner Intake browser published a fixed-price product; D1 identity, private R2 WebP/PDF, public page, validation, duplicate rejection, invalid-file rollback, free and PWYW validation all passed. A first R2 control-plane read received transient HTTP 524; the fully cleaned retry passed. |
| Owner pricing and availability | PASS | Actual authenticated Owner Pricing browser changed fixed pricing, exercised free/PWYW validation, rejected stale revisions and invalid bounds, paused the product, and immediately changed storefront/cart quote behavior without redeployment. The first launch encountered a transient Wrangler authentication error before data creation; the retry passed. |
| Owner homepage curation | PASS | Actual authenticated browser reordered disposable native products, observed immediate public reflection, rejected stale and unauthorized changes, removed selections, and restored the original homepage row byte-for-byte. |
| Creator submission | PASS | Actual authenticated Creator browser submitted fixed/free/PWYW products to private review state; D1/R2, file validation, eligibility, tier limits, duplicate rejection, and Owner-endpoint denial passed. |
| Owner Creator review, approval, and rejection | PASS | Actual authenticated Owner browser saw complete private metadata/assets, rejected stale and self-approval attempts, approved one product to immediate storefront visibility, and kept a rejected product private. |
| Creator catalog management | PASS | Actual authenticated Creator browser listed only owned products, paused and edited a product, rejected stale/unauthorized edits, required Owner reapproval, and reflected approved changes immediately. |
| Public discovery, detail, cover, visibility | PASS | Current preview discovered and rendered disposable D1 products, Creator/PWYW metadata, and public R2 covers; live updates appeared without redeployment; paused/unknown products returned 404; private PDF paths were denied. Final visual inspection showed the store-closed banner and zero purchasable titles after cleanup. |
| Server-authoritative cart quote | PASS | Current staging accepted valid PWYW, rejected below-minimum and paused products, ignored forged identity/price fields, reflected revision changes without redeployment, and withheld private delivery keys. |
| Native order preparation and immutable snapshots | CONDITIONAL | Full regression suite and earlier isolated staging proof pass. Task 2S-A did not open shared staging, so a new current hosted order was not created. |
| Registered paid checkout and entitlement | CONDITIONAL | Server-side Stripe, signature, amount/currency/order validation, idempotency, immutable snapshots, entitlement recovery, and no-fulfillment-before-payment tests pass. No real Stripe-hosted transaction was performed. |
| Registered free and zero-PWYW acquisition | CONDITIONAL | Authoritative free acquisition, idempotency, entitlement, library, and delivery regression tests pass; current live execution was intentionally not performed because shared staging remained `CLOSED`. |
| My Library and native secure delivery | CONDITIONAL | Native library/ownership isolation and exact PDF delivery regressions pass and earlier staging handoffs record live proof. The current preview lacked persistent download secrets, so a new native-purchase library session was not re-created in Task 2S-A. |
| Guest purchase, notification, and account claim | CONDITIONAL | Native guest checkout, signed-webhook payment, idempotent notification, signed/expiring/reuse-protected claim, wrong-account denial, entitlement transfer, library, and PDF tests pass. Real Stripe and Resend delivery were unavailable in the isolated preview. Guest features remain disabled publicly. |
| Legacy Agency ownership continuity | PASS | Current deployed staging route authorized both preserved paid entitlements and streamed the exact 9,630,946-byte PDF. SHA-256 matched `c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9`; content headers passed; altered/non-canonical credentials returned 403; staging stayed `CLOSED`. |
| Unauthorized access, duplicate requests, stale revisions, entitlement isolation | PASS | Current Owner/Creator/browser checks and deployed Agency check passed; full regression suite covers duplicate webhook/order/claim/download behavior and ownership isolation. |

## Stripe and email

### What was available

The shared staging Pages production environment has named Stripe, Resend, order-hash, checkout-cookie, download-signing, and webhook secrets. Their values were never displayed. The isolated `task2sa-acceptance` preview environment had no encrypted secrets. Shared staging remained `CLOSED` and was not weakened to make an external test pass.

### What passed

- Stripe test-mode key enforcement and rejection of live/production configuration.
- Server-authoritative fixed and PWYW amounts.
- Checkout/order association, amount, currency, payment-status, and signature validation.
- Duplicate and out-of-order webhook idempotency.
- Paid-order entitlement creation and recoverability.
- Injected provider email delivery, retry, idempotency, and safe claim-message content.
- Signed, expiring, single-account guest claim credentials and wrong-account rejection.

### What remains unverified externally

- A real Stripe-hosted Checkout Session completed with a test payment.
- Delivery of the post-payment guest email through Resend to a controlled recipient or test sink.
- The complete browser journey from that hosted checkout through received email, account claim, My Library, and private R2 download.

These are operational verification gaps, not GitHub/Operation Severance dependencies.

### Safest final external test

Create a persistent isolated acceptance environment with its own D1 database and R2 bucket, keep shared staging `CLOSED`, and provide preview-scoped Stripe **test** and controlled Resend test credentials plus the existing signing secrets. Deploy the exact accepted commit to that isolated environment, set only that isolated store `OPEN`, complete one hosted test checkout and email/claim/library/download journey, verify provider dashboards and D1/R2 state, then delete the disposable data and return the isolated store to `CLOSED`. Do not copy live keys or open shared staging.

## Operation Severance dependency audit

### Executable runtime blockers

**None.** Runtime scans and `test:operation-severance` found no executable GitHub API, repository dispatch, workflow dispatch, publication token, repository commit, or GitHub-driven product publication path.

### Legacy migration blockers

**None.** Agency is the only native continuity identity for the former catalog, and the other four historical product records remain unpublished. Agency authorization and delivery use D1 plus private R2 and do not consult generated catalog mappings.

### Dormant compatibility code

The empty generated runtime catalog and folder map remain as compatibility inputs for legacy-only fallbacks in cart, library, free-download, Owner legacy inspection, and related modules. Native D1 resolution wins for native identities, including retired Agency, and current generated product data is empty. These references are dead/dormant migration compatibility, not executable operational dependencies and not a Severance blocker. They may be removed in later cleanup after legacy compatibility policy is retired.

The Owner Pricing and Intake browser scripts still read `/data/products.json` only to distinguish legacy-only records during migration. Static guest-preview JSON powers fictional preview shelves, not operational marketplace products.

### Development-only GitHub references

- `package.json` repository, issue, and homepage metadata.
- `.github` CI/deployment workflows and normal source control.
- Retired/legacy test fixtures containing mock `GITHUB_*` values.

These do not execute in marketplace runtime operations.

## Automated verification

- Disposable staging D1 catalog/revision test: passed.
- Native D1/R2 publication and rollback test: passed.
- D1 storefront/discovery/update/visibility test: passed.
- D1 cart/PWYW/revision/availability test: passed.
- Authenticated Owner Intake browser test: passed after one transient R2 524 and clean retry.
- Authenticated Owner Homepage browser test: passed.
- Authenticated Creator submission/review/catalog browser test: passed.
- Authenticated Owner Pricing browser test in CLOSED-safe mode: passed after one pre-write transient Cloudflare authentication error and clean retry.
- Live Agency entitlement/download test: passed after the credential-hardening fix.
- `npm test`: passed in full.
- `npm run build:pages`: passed; 218 allowlisted files.
- `npm run test:pages-build`: passed.
- Wrangler 4.44.0 Pages Functions compilation: passed.
- `npm run test:storefront-visual`: passed; no locked storefront baseline changed.
- Runtime GitHub dependency scan and `test:operation-severance`: passed.

## Preview and cleanup evidence

- Final fix-bearing immutable preview: `https://a427b393.tobacco-road-games-staging.pages.dev`.
- The preview is not the shared production alias and no production deployment occurred.
- Disposable D1 product, order, entitlement, webhook, identity, session, Creator, review, and audit data created by current staging tests were removed.
- Disposable R2 cover/PDF objects were removed.
- Original homepage configuration was restored byte-for-byte.
- Temporary preview download-signing secret was deleted; preview secret list is empty.
- Final staging R2 listing contains only `agency/product.pdf`.
- Local temporary Agency probe and Task 2S-A compilation directory were removed.

## Production prerequisites

1. Review and approve acceptance-fix commit `11c8566`.
2. Perform the isolated real Stripe test-mode plus controlled Resend end-to-end test described above.
3. Deploy the accepted branch to the shared staging alias, still `CLOSED`, and repeat a short Owner/Creator/public/Agency smoke test with the staging secrets that deployment is intended to use.
4. Take production D1/R2 backups and verify production migrations, bindings, secret names, store-state controls, and rollback procedure without applying unrelated migrations.
5. Schedule a controlled production deployment. Keep production `CLOSED` until post-deploy read-only and authenticated operational checks pass; opening commerce is a separate Owner decision.

There are no remaining GitHub runtime or legacy migration blockers. The remaining work is external-service acceptance and controlled rollout, not marketplace reconstruction.
