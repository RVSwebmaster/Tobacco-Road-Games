# Operation Severance — Task 2T Handoff

Date: 2026-11-05  
Branch: `codex/operation-severance-task1`  
Baseline: `175ef89`  
Scope: Stripe sandbox-key migration accounting and production-readiness audit only.  
Production, shared staging, and isolated acceptance: no writes, deployments, payments, or email sends were performed by this task.

## Executive determination

**Operation Severance remains technically complete.** The executable-runtime scan and `test:operation-severance` find no GitHub API, repository/workflow dispatch, publishing-token, repository-write, generated-catalog publication, or redeployment requirement for ordinary native marketplace operations. The remaining generated-catalog references are the documented dormant migration-compatibility branches; they are not used by native D1/R2 operations or Agency continuity.

**TRG is not ready for a production marketplace launch.** This is a production-readiness finding, not a GitHub-severance regression. The production Pages deployment and database predate the native catalog/order/entitlement migrations; production lacks the required provider secret bindings and has not yet had its named delivery secrets validated as a complete production set; and the native paid-product route deliberately rejects `PAYMENT_PIPELINE_STAGE=production`. No production data or configuration was changed to reach this conclusion.

## Safety and current environment evidence

| Environment | Pages project / D1 / R2 | Store state | Current deployment evidence | Result |
| --- | --- | --- | --- | --- |
| Acceptance | `tobacco-road-games-acceptance` / `trg-orders-acceptance` (`2fff6e72-4e41-47e7-b497-992dadcab3d6`) / `trg-products-acceptance` | `CLOSED` | production deployment `7a5245ea`, built from `baf48a4` | Isolated and closed. |
| Shared staging | `tobacco-road-games-staging` / `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`) / `trg-products-staging` | `CLOSED` | production deployment `e96094b5`, branch `staging`, commit `4bb1ccf0` | Closed; its deploy is behind the reconstruction branch. |
| Production | `tobacco-road-games` / D1 `7e2cd675-a6f1-4fac-bbc9-03485a806c26` / `trg-products` | `CLOSED` | production deployment `0496b997`, branch `main`, commit `233aa0c` | Untouched and closed. |

All three state checks were read-only. Acceptance and staging were queried with Wrangler against their explicit D1 targets; production was queried read-only through the Cloudflare D1 API.

## A. Stripe sandbox credential migration

### What is accounted for

- The isolated acceptance project has named encrypted Stripe, Resend, signing, cookie, and order-hash secrets. Its acceptance-only bindings remain D1 `trg-orders-acceptance` and R2 `trg-products-acceptance`.
- The current acceptance deployment is still configured for test operation: `PAYMENT_PIPELINE_STAGE=staging`, guest checkout/claim disabled, and Resend delivery disabled.
- The previously completed isolated acceptance run verified one real Stripe **sandbox** Checkout transaction, a genuine signed webhook, one paid entitlement, authenticated library visibility, and an exact private-R2 PDF download. The replacement sandbox key was active for that run. This task did not repeat a transaction.
- Shared staging has named `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` bindings, but Cloudflare correctly keeps their values opaque. This audit cannot establish whether staging still holds the expiring former sandbox key.
- Production currently has **no** `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` binding. It must receive separately controlled live-mode credentials only as part of an authorized production rollout; no acceptance or staging secret may be copied there.

### Expiration risk and required action

The former Stripe sandbox key was reported as being in its seven-day grace period after the November 4 rotation. It must **not** be revoked until every non-acceptance consumer of that key is accounted for.

The only identified possible remaining consumer is the shared-staging Pages production environment. Because secret values are opaque and no safe read-only Stripe probe exists in the deployed staging application, Engineering cannot prove key equivalence or migrate the encrypted value by itself. The single required owner-controlled action, if staging needs the old key, is to set the current sandbox secret as the encrypted `STRIPE_SECRET_KEY` for `tobacco-road-games-staging` through the authorized Cloudflare secret mechanism, deploy the closed staging build, and validate it with a non-transactional Stripe read-only probe. Do not change `STRIPE_WEBHOOK_SECRET` as part of that repair.

Only after that validation and any other Stripe-dashboard consumers are confirmed migrated should the former key be revoked in Stripe. No secret values were read, printed, stored in source, command arguments, or this report.

## B. Marketplace readiness matrix

| Subsystem | Status | Evidence / condition |
| --- | --- | --- |
| Cloudflare-native catalog, D1/R2 publication, public discovery and private delivery | READY IN NON-PRODUCTION | Acceptance and staging lifecycle tests passed. Production lacks migrations `057`–`069`, deployment parity, and data/configuration preflight. |
| Owner Intake, Pricing, Homepage | READY IN STAGING | Task 2S-A authenticated browser acceptance passed; D1 changes reflected without a rebuild. Production deployment is behind. |
| Creator submit, Owner review/reject, Creator catalog | READY IN STAGING | Task 2S-A authenticated browser acceptance passed, including ownership, eligibility, conflicts, pause/reapproval and immediate D1 storefront reflection. |
| Public pricing/cart/order snapshots | READY IN STAGING | D1 cart, fixed/free/PWYW, revision and availability regressions pass. |
| Registered native paid checkout | ACCEPTANCE-PROVEN / PRODUCTION-BLOCKED | A real isolated sandbox purchase was completed after Task 2S-A. However, `native-stripe-payment.mjs` deliberately returns 503 whenever pipeline stage is `production` or the key is not `sk_test_`. Production paid checkout requires a separately authorized implementation and live-mode verification. |
| Stripe webhook, paid entitlement, Library, secure PDF | ACCEPTANCE-PROVEN / PRODUCTION-BLOCKED | Signed sandbox webhook, idempotency, entitlement, library and exact R2 download are proven in acceptance. Production has no Stripe secret bindings and lacks the native migrations; its named delivery/order secrets must be verified as a complete, production-specific set before rollout. |
| Free and zero-PWYW acquisition | REGRESSION-PROVEN / NEEDS PROD SMOKE | Native acquisition and entitlement regressions pass. It must be revalidated after production migrations and identity/session setup. |
| Guest checkout, email, and account claim | IMPLEMENTED BUT DISABLED | Gates are disabled in acceptance; production lacks the guest gate variables and the policy currently allows guest modes only for the staging pipeline. Treat public guest purchasing as a launch blocker until a separately approved production policy, live provider configuration, and controlled verification exist. |
| Resend | ACCEPTANCE-PROVEN / PRODUCTION-UNCONFIGURED | Controlled Resend delivery was previously verified in acceptance. Production has neither `RESEND_API_KEY` nor `RESEND_WEBHOOK_SECRET`/reply-to binding in the Pages project. |
| Legacy Agency continuity | READY IN STAGING | Migration 069 and the exact 9,630,946-byte private PDF are present in staging; six historical orders and two paid entitlements are preserved. Production contains no migrated Agency continuity identity or recovered asset. |
| Store-state, authentication and session controls | READY IN STAGING / NEEDS PROD INVENTORY | All audited databases are CLOSED. Acceptance browser authentication was proven with a disposable verified account. Production must receive its own secret inventory and post-deploy closed-state checks. |
| GitHub operational dependency | PASS | No executable runtime match. Production retains a `GITHUB_TOKEN` binding, but no current marketplace runtime code references it. It is dormant configuration and should be removed under the production change plan, not treated as a runtime dependency. |

## C. Production configuration and migration audit

### Migration state

Acceptance and staging have the current native migration set through `069_agency_asset_recovery.sql`. Production's latest applied migration is `056_news_chiron.sql`. Therefore production is missing the following required marketplace schema changes:

1. `057_marketplace_product_catalog.sql`
2. `058_native_d1_order_foundation.sql`
3. `059_native_d1_stripe_payments.sql`
4. `060_native_paid_purchase_entitlements.sql`
5. `061_secure_native_product_delivery.sql`
6. `062_native_free_product_acquisition.sql`
7. `063_homepage_configuration.sql`
8. `064_creator_native_submission_pricing.sql`
9. `065_creator_native_review_publication.sql`
10. `066_native_guest_purchase_claims.sql`
11. `067_native_guest_claim_credentials.sql`
12. `068_agency_legacy_continuity.sql`
13. `069_agency_asset_recovery.sql`

Do not apply this batch blindly. Before any production migration, export/backup the production D1 database, inventory the production R2 bucket, review each migration against real production records, and rehearse the exact sequence in a fresh production-like isolated database. D1 schema changes are not undone by a Pages rollback; recovery must be forward-only or restored from an approved backup.

### Binding and secret gaps

Production production binding is correctly isolated to its own D1 and `trg-products` R2 bucket, and its `PAYMENT_PIPELINE_STAGE` is `production`. Its **preview** environment is unsafe for marketplace testing because it currently binds `TRG_ORDERS` to the shared staging D1. Do not use that preview for any write test; give it isolated preview resources or disable marketplace writes there.

Before deployment, production needs a reviewed, least-privilege secret and variable manifest. At minimum, inventory and set, without placing values in Git:

- `STRIPE_SECRET_KEY` (new, live-mode, production-only credential), `STRIPE_WEBHOOK_SECRET`, and an endpoint configured for the production origin;
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `RESEND_REPLY_TO` after sender-domain verification;
- `CHECKOUT_ACCESS_COOKIE_SECRET`, `DOWNLOAD_SIGNING_SECRET`, `ORDER_ACCESS_SIGNING_SECRET`, and `ORDER_EMAIL_HASH_SECRET`;
- owner/account/CSRF secrets, owner identity controls, and relevant forum/Office secrets already used by production;
- production `PUBLIC_SITE_ORIGIN`, explicit guest gate policy, and a verified `PAYMENT_PIPELINE_STAGE=production`.

Remove the dormant production `GITHUB_TOKEN` during the authorized configuration change after confirming no non-marketplace production component relies on it. It is not a substitute for the completed runtime scan, and it should not be copied into future deployments.

## D. Founding Creator planning (no implementation performed)

Existing foundations: Creator identity, approval/review, catalog capacity enforcement, immutable sale snapshots, fee policies, creator earnings/payout ledgers, payout-readiness data, a Stripe Connect **sandbox** helper, launch-window selection, and a `Founding Creator` badge exist. The current marketplace policy is not the requested plan: it uses a 10% launch/preferred fee and 20% standard fee, rather than Founding 5% and Standard 10%.

Required design and implementation decisions before announcing the program:

1. Add immutable, purchase-time commission-plan snapshots that encode Founding 5%, Standard 10%, the creator-paid processor-fee policy, effective date, and a no-increase-through-public-launch-plus-24-months commitment. Existing generic fee policies can lower a rate but do not enforce an individual guarantee.
2. Define a controlled invitation/eligibility and acceptance workflow. The current founding badge selects already-approved Creators by a configured time window; it is neither an invitation system nor a capacity-limited Founding cohort.
3. Decide the exact permanent-recognition presentation and whether optional benefits (advertising credits, commission reductions, coupons) are contractual, discretionary, time-bounded, transferable, or revocable. Current badges and ad-credit mechanisms do not encode those promises.
4. Complete production-grade Stripe Connect/onboarding, tax, payout execution, reconciliation, reserve/dispute/refund allocation, and Creator-facing accounting before promising cash payouts. The current Connect helper is explicitly sandbox-only.
5. Preserve creation-method neutrality in policy/UI. There is no need to add an AI disclosure requirement; avoid introducing one incidentally in Creator forms or review criteria.

## E. Ordered rollout and recovery plan

1. **Credential containment:** identify every former sandbox-key consumer; update closed shared staging if needed; run a harmless authenticated read-only Stripe check; then revoke the former key. Keep acceptance, staging, and production closed throughout.
2. **Production rehearsal:** create a fresh isolated rehearsal database/bucket from the exact production migration starting point; apply and validate `057`–`069`; verify migration ledger, bindings, Agency continuity source strategy, and no data-loss assumptions.
3. **Production preflight:** backup/export production D1, inventory R2, capture schema/row counts, verify production store is CLOSED, record current Pages deployment, and review every secret-name/binding difference. Correct the unsafe production-preview-to-staging binding before anyone uses previews.
4. **Implement the paid-production boundary:** separately authorize and implement native live Stripe checkout (it is intentionally blocked today), with live-key validation, webhook endpoint/signature verification, order/amount/currency validation, idempotency, and a controlled real-money policy. Do not weaken the current test-only guard.
5. **Controlled closed deployment:** deploy the reviewed branch to production while CLOSED; apply only the reviewed migrations; verify the exact deployed binding manifest, no GitHub runtime secret/use, D1/R2 isolation, public non-purchasable routes, and Owner/Creator authorization.
6. **Post-deploy smoke:** run a closed-state Owner/Creator/public/Agency read-only smoke pass, then an explicitly authorized payment/email test plan appropriate for live mode. Opening commerce is a separate Owner decision.
7. **Rollback/recovery:** use the prior Pages deployment only for code rollback; it cannot roll back D1/R2. Keep the store CLOSED, disable payment/email gates, preserve forensic webhook/order data, and use a forward migration or approved backup restoration for data recovery.

## F. Milestone execution plan

### Milestone A — Private Founding Creator onboarding

| Priority | Engineering action | Dependencies | Required verification | Completion criterion | Owner involvement |
| --- | --- | --- | --- | --- | --- |
| A1 | Specify and implement a Founding Creator cohort/invitation record with an auditable acceptance state; do not use a date-window badge as an access-control substitute. | Business definition of cohort size, invite authority, and acceptance terms. | Unit/integration tests for invitation, acceptance, refusal, expiry, duplicate, and unauthorized access. | Only explicitly invited, verified accounts can enter the Founding workflow. | Required for the cohort and terms. |
| A2 | Implement immutable per-sale commission-plan snapshots: Founding 5%, Standard 10%, creator-paid processor fees, public-launch anchor, and 24-month no-increase guarantee. | A1 and precise legal/economic rules for refunds, disputes, currency, and promotions. | Snapshot/repricing/refund/dispute accounting tests; boundary-date tests at 24 months. | Every new order records a durable applicable rate and never changes historical Creator earnings. | Required to approve the terms. |
| A3 | Define which Founding benefits are contractual versus discretionary, then encode only approved privileges (recognition badge, ads, coupons, or additional commission reductions). | A1/A2. | Permission and expiration/revocation tests for each approved privilege. | The displayed promise exactly matches enforceable data and controls. | Required for each benefit. |
| A4 | Complete production-grade Creator payout readiness before promising cash distribution. | Live Stripe Connect/account, tax, payout, reserve, dispute, and reconciliation policy. | Controlled non-live/isolated provider tests plus financial-ledger reconciliation. | Payouts are either fully operational with controls or explicitly not offered. | Required for provider/legal/tax decisions. |

### Milestone B — Production marketplace readiness while CLOSED

| Priority | Engineering action | Dependencies | Required verification | Completion criterion | Owner involvement |
| --- | --- | --- | --- | --- | --- |
| B1 | Finish sandbox-key migration: account for staging's old key, securely install the rotated key if necessary, perform a harmless read-only authentication check, then revoke the old key. | Secure access to the rotated sandbox secret; Stripe consumer inventory. | Closed-staging key/auth check; no checkout, orders, or emails. | Former key is revoked only after all consumers pass on the replacement. | Only if the secret is not available in an authorized secret manager. |
| B2 | Build a reviewed production binding/secret manifest and isolate or disable production previews that currently bind staging D1. | B1; production access review. | Read-only config diff against acceptance/staging; preview write-denial/isolation check. | No preview or nonproduction path can write production or shared-staging marketplace data unintentionally. | Required only to set opaque production secrets later. |
| B3 | Rehearse migrations 057–069 against a fresh production-like isolated D1/R2 environment; inventory production D1/R2 and prepare backup/restore evidence. | B2, production read-only inventory. | Migration ledger, schema, row-count, Agency, R2, and recovery drill checks. | A reviewed, data-specific runbook exists; no production migration has run. | Backup/retention approval if provider settings require it. |
| B4 | Implement the separately authorized native live-Stripe payment boundary; retain the current test-only guard until then. | B2/B3; live Stripe credentials, webhook endpoint, payment policy. | Isolated live-mode-safe tests, signature/amount/currency/idempotency tests, security review. | Production code can accept only valid live-mode payments when the store is explicitly OPEN. | Required for live credentials and real-money policy. |
| B5 | Deploy the reviewed reconstruction branch to production while CLOSED, apply only approved migrations, and run closed-state smoke checks. | B2–B4 and explicit production deployment authorization. | Binding/secret-name check, D1/R2 integrity, Owner/Creator/auth/Agency read-only smoke. | Production has schema/code/config parity and remains non-purchasable. | Required: production change authorization. |

### Milestone C — Public customer store opening

| Priority | Engineering action | Dependencies | Required verification | Completion criterion | Owner involvement |
| --- | --- | --- | --- | --- | --- |
| C1 | Conduct one tightly controlled live production payment/entitlement/library/download acceptance pass, with documented reversal procedure. | B5, a deliberately approved live payment policy. | Stripe webhook, one entitlement, duplicate-event safety, exact private R2 bytes, account isolation. | Paid flow is proven without weakening authorization or exposing private keys. | Required for a live-money transaction. |
| C2 | Decide whether guest purchases launch with the store. If yes, extend the policy from staging-only gates to production with live Resend/claim verification; if no, leave gates disabled and publish that scope. | B4/B5; claim/email policy and controlled inbox. | Provider delivery, signed claim, wrong-account, expiry/reuse, and recovery tests. | Guest capability is either safely enabled or explicitly unavailable. | Required for public feature decision and controlled recipient. |
| C3 | Open the store only after C1 and applicable C2 pass; monitor provider/webhook/error/entitlement signals and retain a close-store runbook. | C1/C2, communications and operational staffing. | Post-open quote, payment, download, and audit sampling; no GitHub-runtime scan regression. | Customers can transact through Cloudflare/Stripe/Resend without repository operations. | Required: explicit opening decision. |

Optional improvements not on the critical path: removal of dormant generated-catalog compatibility code after legacy policy retirement; storefront redesign; ZIP packaging; reputation-system expansion; refunds/royalties beyond the separately approved accounting work.

## Ranked blockers

1. **Critical — production schema and deployment lag:** production remains on migration 056 and an October 28 main deployment; it cannot run the native reconstruction.
2. **Critical — native paid checkout is deliberately test-only:** the production-stage route rejects live credentials. A live payment implementation/verification task is required before paid launch.
3. **Critical — missing production provider and delivery secrets:** Stripe, Resend, and native checkout/download/order secret bindings are absent from the production Pages configuration.
4. **High — production data/asset migration plan:** production catalog, Agency continuity record/asset, existing ownership, and R2 preservation must be explicitly inventoried and migrated or preserved; no acceptance fixtures may be copied.
5. **High — stale sandbox key retirement:** shared staging may still use the former test key; update/verify it before revocation.
6. **High — guest launch policy:** guest checkout/claim is intentionally staging-gated and currently disabled. It cannot be quietly enabled in production.
7. **Medium — unsafe production preview binding:** preview currently targets shared staging D1; isolate or disable it before any preview writes.
8. **Medium — Founding Creator program rules:** rates, 24-month guarantee, invitations, fee treatment, and payout commitments are not yet encoded.

## Recommended next Codex assignment

**Task 2U — Production Launch Readiness Remediation (planning and isolated rehearsal only).** Build a reviewed production configuration manifest, create an isolated production-migration rehearsal from migrations 057–069, verify backup/restore procedures and preview-resource isolation, and specify the minimal live-Stripe enablement change. It must not deploy to production, move production data, set live secrets, or open the store. A subsequent explicitly authorized task should implement and test the native live-payment boundary.

## Verification performed in Task 2T

- read-only Cloudflare Pages project, deployment, binding, secret-name, and D1 migration-ledger inspection;
- read-only D1 store-state checks: acceptance CLOSED, shared staging CLOSED, production CLOSED;
- executable GitHub-runtime scan: no runtime source matches;
- `npm run test:operation-severance` — passed;
- `npm run test:agency-legacy-continuity` — passed (six historical orders, two paid entitlements, no republished historical products);
- native Stripe, entitlement, and secure-delivery regression commands — passed;
- full `npm test` — passed;
- `npm run build:pages` — passed (218 allowlisted files);
- `npm run test:pages-build` — passed;
- Wrangler 4.44.0 Pages Functions compilation — passed;
- `npm run test:storefront-visual` — passed; no locked storefront baseline changed.

One optional legacy harness, `npm run test:creator-publishing-end-to-end`, failed as documented retired behavior: it injects mock `GITHUB_*` publication configuration and expects the former Creator publication completion path to return HTTP 200. Its maintained replacement is `test:creator-native-submission` plus the Owner-review and catalog tests, which passed. The harness is outside `npm test`; no production-readiness code was changed to satisfy its obsolete expectation. A nonexistent `npm run test:account-auth` alias was also avoided in favor of the maintained `node scripts/test-account-auth.js` command, which passed.

## Final state

No marketplace code or deployment configuration was changed in this task. This handoff is the only intended repository change. Acceptance, shared staging, and production are CLOSED; production was not modified.
