# Tobacco Road Games Final Launch Readiness Audit

Audit date: 2026-10-16

Target launch date assessed: 2026-11-28

Canonical workspace: `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`

Audit mode: read-only except for this report and its companion punch list

## Historical-record notice and current schedule

This document preserves the findings and launch assumptions recorded on October 16, 2026. References below to a November 28 customer-only opening, a later Creator rollout, production being `OPEN`, and a red regression gate describe that historical checkpoint; they are not the current operating plan or current state.

RV established the controlling schedule on October 17, 2026:

- **November 28, 2026:** the entire marketplace is functionally complete, including Customer, Creator, and Owner operations.
- **December 2026:** Creator recruitment, onboarding, catalog preparation, and launch marketing use the completed marketplace.
- **January 1, 2027:** the public marketplace launches.
- No functional marketplace capability is intentionally deferred beyond November 28.

As of the October 17 documentation review, production is `CLOSED`, staging is `CLOSED`, all 69 individual test scripts pass, the full `npm test` command passes, and the completed code checkpoint is commit `4f74cf4d313172de8d2f1d9325450b868eb3da11`. The companion punch list carries the current schedule and completion boundary.

## A. Executive status

**NOT READY — MATERIAL SYSTEM WORK REMAINS**

The application architecture is substantially stronger than the current public operating state suggests. Core account, checkout, entitlement, Creator ledger, payout-policy, review-hold, file-maintenance, and store-state controls exist, and the focused financial regression suites still pass. The November 28 customer launch is nevertheless not ready today because the public catalog and delivery inventory are empty, production lacks the live payment and email configuration required by reachable customer paths, the isolated staging environment cannot currently complete the required owner/publication/delivery rehearsal, and the repository-wide regression gate is red.

There are also public policy and launch-scope inconsistencies: a standalone AI policy was reintroduced despite the settled broader marketplace principle; its RV Sawyer quotation is altered and incompletely attributed; prohibited public `TRG` shorthand remains on the homepage; customer terms/privacy/refund surfaces are absent; and public Creator registration currently asks people to accept an expressly described placeholder agreement even though live Creator operations are not production-ready.

November 28 can remain a realistic **customer storefront launch with Tobacco Road Games-owned digital products**. It does not require completing every multi-Creator feature. To preserve that boundary, public Creator enrollment and charge-capable Creator operations must remain unavailable until the later Creator rollout is approved. Live Connect, external Creator payouts/refunds, scheduled Creator lifecycle jobs, marketplace notice delivery, counsel-final Creator agreement language, and a production file-safety process are later-rollout work—not blockers to a customer-only launch if the public enrollment path is held.

No code, schema, Cloudflare configuration, production data, bucket object, payment, deployment, branch, or approved visual design was changed during this audit.

## B. Current source state

| Item | State |
|---|---|
| Current branch | `staging` |
| Working tree at audit start | Clean |
| `HEAD` | `d1a5e916baf43bceffea6d4598e56c86dee35ae9` |
| local `staging` | `d1a5e916baf43bceffea6d4598e56c86dee35ae9` |
| `origin/staging` | `d1a5e916baf43bceffea6d4598e56c86dee35ae9` |
| local `main` | `d1a5e916baf43bceffea6d4598e56c86dee35ae9` |
| `origin/main` | `d1a5e916baf43bceffea6d4598e56c86dee35ae9` |
| `origin/HEAD` | `origin/main` at the same commit |
| `main...staging` | 0 ahead / 0 behind |
| `origin/main...origin/staging` | 0 ahead / 0 behind |

The meaningful reconciliation merge `cf9b940` remains in history and records the production Office hotfix merge into staging. No unexpected staging-only merge or production hotfix gap exists. Other local branches are historical or focused work branches and are not part of the current launch candidate.

The currently successful Cloudflare deployments also identify source commit `d1a5e91`:

- Production Pages project `tobacco-road-games`: deployment `dc3641be-50a2-47a5-a656-ea9b9de8d621`.
- Isolated staging Pages project `tobacco-road-games-staging`: deployment `f5bb95df-d484-4d41-b1a9-0b0eb021fd2a`.

## C. Production delta

There is **no source-code delta** between staging and production/main. The current risk is environmental and operational, not an unpublished branch stack.

The important environment differences are:

- Production D1 is migrated through 052 and reports `OPEN`.
- Staging D1 is migrated through 051 and reports `CLOSED`; 052 is intentionally absent.
- Staging has test Stripe and Resend-related secrets but is missing several secrets required for a complete rehearsal.
- Production has owner/download/order signing and GitHub dispatch secrets but does not have the live Stripe, Resend, Google, forum-rate-limit, or Connect secrets in the encrypted-secret inventory.
- Both deployments serve the same empty runtime catalog.

## D. Migration status

The repository contains 53 migration files, numbered through `052_open_store_state.sql`. The count exceeds the highest number because two different migrations use the `048` prefix:

- `048_creator_closure_integrity.sql`
- `048_shelf_curios.sql`

D1 tracks full filenames, and both are applied in both environments, so there is no current collision. The duplicate number is operationally confusing and should not be repeated.

| Environment | Applied files | Highest applied filename | State |
|---|---:|---|---|
| Production `trg-orders` | 53 | `052_open_store_state.sql` | Complete relative to repository; store `OPEN` |
| Staging `trg-orders-staging` | 52 | `051_creator_listing_review_hold.sql` | Only 052 absent; store `CLOSED` |

Recent marketplace migrations are applied in production: payout policy 044, owner adjustments 045/047, Creator closure 046/048/049/050, shelf curios 048, review hold 051, and store-open state 052. None remain to be promoted to production from the current source tree.

Migration 052 is not a schema migration. It unconditionally upserts `runtime_settings.store_state='OPEN'`. Applying it to staging would open staging. It should not be included in a generic “apply everything pending” rehearsal step. Production already applied it on 2026-10-05. A future launch procedure must treat store state as an explicit operational control, not as a side effect of schema migration.

No current migration is required for the routing, catalog, customer configuration, policy-copy, or test-harness work identified by this audit. Any future repair that appears to need a migration should be separately reviewed.

## E. Genuine November 28 launch blockers

### E1. No launch catalog or deliverable product inventory

- **Reachability:** Certain. `data/products.json` is `[]`, `shared/runtime-catalog.mjs` exports no products, `shared/product-folder-map.mjs` is empty, and `store/products/` does not exist. Production has 12 legacy D1 listing rows but every one is `not_approved`; there are zero `creator_listing_files`.
- **Likelihood:** 100% for every visitor.
- **Materiality:** Browsing pages load, but there is no real product page, quote, acquisition, checkout, entitlement, or delivery path a customer can complete.
- **Existing controls:** Checkout and fulfillment fail closed for products absent from the generated runtime catalog; unpublished D1 listings cannot become saleable merely because a row exists.
- **Repair cost/risk:** Moderate operational content work. Publish the intended Tobacco Road Games launch catalog and exact R2 delivery objects through the canonical pipeline, first in isolated staging. Do not revive the retired legacy fixtures wholesale.
- **Classification:** **FIX BEFORE OPENING**.

### E2. Production customer transaction and communication configuration is absent

The encrypted production secret inventory contains only `CHECKOUT_ACCESS_COOKIE_SECRET`, `DOWNLOAD_SIGNING_SECRET`, `GITHUB_TOKEN`, `ORDER_ACCESS_SIGNING_SECRET`, `ORDER_EMAIL_HASH_SECRET`, `OWNER_CSRF_SECRET`, `OWNER_PASSWORD_HASH`, and `OWNER_SESSION_SECRET`.

It does not contain `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `FORUM_RATE_LIMIT_SECRET`, or `STRIPE_CONNECT_SECRET_KEY`. No secret values were read.

- **Reachability:** Paid checkout directly requires `STRIPE_SECRET_KEY`; verified guest checkout, account verification/password reset, and delivery mail require Resend; forum mutations require the forum secret. The live account endpoint confirms Google client configuration is absent in production.
- **Likelihood:** Certain once a customer tries the affected path.
- **Materiality:** Paid checkout cannot start. Password registration can create an unverified row but cannot send verification; guest verification cannot complete; order delivery email cannot be sent; public forum writes fail closed. A live Stripe key would also be rejected unless `PAYMENT_PIPELINE_STAGE=production` is explicitly present.
- **Existing controls:** All of these paths fail closed. No money can be charged with a missing Stripe key, and no unsigned webhook is accepted.
- **Repair cost/risk:** Moderate configuration and provider-verification work. Install live values only after the catalog and staging rehearsal are approved. Verify endpoint-specific webhook secrets and sender/domain status. Google remains optional if email/password auth is deliberately accepted as the launch method.
- **Classification:** **FIX BEFORE OPENING** for Stripe, Resend, production stage, webhook, and forum posting configuration. Google configuration is required only if Google sign-in is part of the November promise.

### E3. Production is already `OPEN`, and migration 052 makes accidental opening operationally reachable

- **Reachability:** Direct and current. `GET /api/store/status` reports `OPEN`; production D1 confirms the value was written by migration 052. Owner controls can change it, but catalog publication and Git-triggered production deployment do not automatically force it closed.
- **Likelihood:** High during catalog restoration unless the sequence is controlled. The owner publication workflow targets `main` by default, and a main push triggers production Pages.
- **Materiality:** Once a saleable product and live Stripe configuration exist, publishing while this state remains `OPEN` makes the item immediately purchasable before closed-state smoke testing.
- **Existing controls:** The current empty catalog prevents checkout today. Server-side checkout, free acquisition, and store middleware all honor store state. The owner control is authenticated and audited.
- **Repair cost/risk:** Low operational cost. Set production to `CLOSED` before launch inventory or live payment configuration is introduced, document the explicit open step, and prevent 052 from being blindly applied to staging.
- **Classification:** **FIX BEFORE OPENING**.

### E4. The isolated staging environment cannot complete the required launch rehearsal

Staging correctly targets `trg-orders-staging`, `trg-products-staging`, test Stripe, and the isolated `tobacco-road-games-staging` Pages project. It nevertheless lacks:

- `ORDER_ACCESS_SIGNING_SECRET`, while `RESEND_DELIVERY_ENABLED=true`; verified paid orders can receive entitlements but delivery email becomes a retryable configuration failure.
- An effective owner-auth configuration for the Pages staging hostname; `/owner/` redirects to the fallback login, but the required owner password/session secrets are absent from the staging secret inventory.
- `GITHUB_TOKEN` and an explicit `GITHUB_PUBLISH_REF=staging`; publication cannot complete, and the code otherwise defaults the target ref to `main`.
- `RESEND_WEBHOOK_SECRET`, so delivered/bounced/suppressed status cannot be reconciled.

- **Reachability:** Direct through the ordinary owner, publication, and post-payment delivery paths required by the rehearsal.
- **Likelihood:** Certain in a complete rehearsal.
- **Materiality:** Owner controls cannot be proven end to end, a real staged product cannot be published through the normal pipeline, and a guest cannot receive the secure order-access message.
- **Existing controls:** The environment is safely isolated from production and fails closed. The allowlisted `ops/staging/deploy.ps1` targets only `tobacco-road-games-staging`.
- **Repair cost/risk:** Low-to-moderate environment configuration plus one explicit staging publication/deployment procedure. No application migration is indicated.
- **Classification:** **FIX BEFORE OPENING** because the launch rehearsal is a prerequisite to production activation.

### E5. The automated launch gate is red

`npm test` fails in `pretest` at `test-preferred-internal-purchase-repairs.js`. Running all 68 `scripts/test-*.js` files independently produced 57 passes and 11 failures:

1. `test-creator-account-closure.js`
2. `test-customer-delivery.js`
3. `test-launch-week-creator-reputation.js`
4. `test-marketplace-architecture.js`
5. `test-marketplace-discovery-labels.js`
6. `test-marketplace-pass6.js`
7. `test-preferred-internal-purchase-repairs.js`
8. `test-secure-download.js`
9. `test-storefront-hero-books.js`
10. `test-storefront-shelf-themes.js`
11. `test-stripe-webhook.js`

The delivery, webhook, marketplace, and Preferred failures largely assume that the retired `agency` product remains in the runtime catalog or that generated product pages still exist. The runtime correctly rejects that nonexistent catalog item. Two storefront tests assert obsolete markup/cache-bust details. The closure test is timing-sensitive because it creates `requested_at` using wall-clock `new Date()` while migration 050 compares against SQLite `now`; it passed once and failed in repeated runs.

- **Reachability:** The red gate occurs on every normal `npm test` run. The underlying customer behavior represented by the stale tests is launch-critical even if the immediate failures are obsolete fixtures.
- **Likelihood:** Certain.
- **Materiality:** A red suite masks real regressions and prevents a trustworthy release decision. It does not by itself prove that entitlement or webhook code is broken.
- **Existing controls:** Focused financial, payout, refund, review-hold, Preferred policy, Creator Balance, registration hard-gate, store kill-switch, and owner financial-control tests pass.
- **Repair cost/risk:** Low-to-moderate test-fixture modernization and one clock-stability correction. Re-run the whole suite after a real staged launch product exists.
- **Classification:** **FIX BEFORE OPENING**.

### E6. Customer legal and recovery surfaces are not launch-ready

No public Terms of Sale, Privacy Notice, or consolidated customer refund/delivery policy file is present. `support.html` tells customers to use a contact route from their order message but provides no independent support address or form. This leaves a customer with no visible recovery contact if the delivery message itself fails.

- **Reachability:** Every account registrant and purchaser is affected; the support dead end is reachable from public navigation.
- **Likelihood:** Certain exposure; support failure is likely only when a transaction needs help.
- **Materiality:** Customers submit personal information and money without accessible governing notices, and a failed delivery can strand the customer without a discoverable contact route.
- **Existing controls:** Transaction code retains orders, entitlements, recovery credentials, owner repair/resend controls, and objective-remediation records.
- **Repair cost/risk:** Primarily counsel/content and a small navigation/support update. Do not invent policy language in code; obtain owner/counsel-approved text.
- **Classification:** **FIX BEFORE OPENING**.

### E7. Settled public policy and naming were regressed

`ai-policy.html` is publicly reachable and linked from 15 pages despite the settled policy canon stating that the standalone public AI philosophy was removed. The page changes the approved quotation (“perfectly legal” is removed and “try” is inserted) and does not present the required `— RV Sawyer` attribution. Four homepage news labels display prohibited public-facing `TRG UPDATE` shorthand.

- **Reachability:** Direct from primary public navigation and the homepage.
- **Likelihood:** Certain for ordinary visitors.
- **Materiality:** Public policy contradicts the approved canon and prior owner instruction; the quotation is not the approved text. Public shorthand risks the exact brand confusion the owner prohibited.
- **Existing controls:** The broader policy canon and agreement draft preserve the correct general principle and exact attributed quotation.
- **Repair cost/risk:** Low, isolated content/navigation work; preserve the locked storefront design and restore only approved copy/presentation.
- **Classification:** **FIX BEFORE OPENING**.

### E8. Creator registration is publicly exposed before the later Creator rollout is ready

The public account page advertises “Become a Creator,” creates a Creator identity, and asks acceptance of a notice that says the “current versioned Creator Agreement placeholder remains in effect while final legal prose is prepared.” Production Connect, Creator payment method collection, live payout/refund execution, schedulers, and notice delivery are not active.

- **Reachability:** Once customer email verification is configured, any verified user can enter the ordinary registration path. The page is currently linked as “Creator Login / Sign Up.”
- **Likelihood:** High once the November site is promoted.
- **Materiality:** A customer-only launch can unintentionally become a Creator-contract and onboarding launch. A person may accept placeholder language and reach a dead-end payment/payout setup.
- **Existing controls:** Registration hard gates prevent listing upload/publication until agreement, payment method, Connect, rights declarations, and eligibility are complete. Missing production provider configuration causes later steps to fail closed.
- **Repair cost/risk:** Low if November 28 is customer-only: hold/hide new Creator registration while retaining account data and existing private tools. High if Creator enrollment is included: complete the later-rollout items first.
- **Classification:** **FIX BEFORE OPENING**, but the required November fix is a rollout gate—not completion of every Creator feature.

## F. Hardening debt

These are real issues but should not block a properly scoped customer-only launch:

- **Account/email atomicity:** registration writes the user and verification token before calling Resend. A provider outage can return an error after the account exists; the user can later sign in and resend, but the initial experience is confusing. Add compensating UX or transaction/outbox semantics later.
- **Closure-time test sensitivity:** migration 050 uses authoritative database time as designed, but the test’s wall-clock timestamp can be a few milliseconds future relative to SQLite. For Creator rollout, use deterministic DB-relative fixture timestamps and consider operational clock-skew tolerance only if it does not weaken the time-authority rule.
- **Ad metrics trust:** the public ad-event endpoint accepts an ad ID/type/event tuple without an authenticated browser proof. Bucketed `INSERT OR IGNORE` limits inflation to one click per minute and one impression per five minutes per ad globally, but paid reporting should receive stronger abuse controls before external sponsors rely on it.
- **Publication partial failure:** owner/Creator publication copies objects before dispatching the GitHub workflow. A dispatch failure is reported and leaves recoverable orphan/staged objects. It does not publish a catalog entry, but cleanup/retry operations should be documented.
- **Migration naming:** two 048 files work because D1 tracks names; future migrations should use unique numbers.
- **Documentation drift:** `STORE-KILL-SWITCH.md` describes the older closed seed without emphasizing migration 052; `R2-PRODUCT-ASSET-ROUTING.md` predates the isolated staging binding; historical audit documents contain superseded activation statements.
- **Failed Git preview noise:** several preview builds on the Git-integrated production Pages project failed, while the isolated staging deployment succeeded. Continue using the isolated allowlisted deployment path and diagnose preview configuration separately.
- **Accessibility conformance:** automated storefront checks pass, but the required manual keyboard, focus, reduced-motion, zoom, and screen-reader rehearsal has not been recorded.
- **Backup operations:** D1/R2 containers exist and prior recovery work proved read-only export capability, but a recurring launch-era backup/restore schedule is not represented in repository operations. Capture a pre-open D1 export and catalog manifest and verify the provider recovery procedure.

## G. Post-launch and later-rollout work

### Customer/storefront post-launch

- General order history beyond digital My Library.
- Coupon/campaign system only after policy is settled.
- Storefront remodel, typography, shelf appearance, Sponsor Marquee visual judgment, animation aesthetics, and other Tier 3 polish.
- Expanded automated accessibility testing after the manual launch pass.

### Later Creator rollout

- Counsel-final Creator Agreement and privacy/retention/IP procedures.
- Production `STRIPE_CONNECT_SECRET_KEY`, Connect onboarding approval, payout execution/reconciliation, and retry/runbook approval.
- Live refund/dispute execution and provider-cost reconciliation.
- Production schedulers for audits, inactivity, remediation, Preferred billing, discovery, and deadlines.
- Marketplace notice email worker and monitoring.
- Production file-safety process beyond signature/type checking and manual owner acceptance.
- Full Creator publication, sales, analytics, payout, Preferred, Creator Credits, additional-identity, review-hold remediation, file replacement, and closure rehearsal.
- Paid external sponsor reporting hardening and advertiser operations.

## H. No-action findings

- **Source synchronization:** staging and production are already the same commit; there is no nine-commit delta or hidden hotfix to reconcile.
- **Financial invariants:** focused tests for sale/ledger integrity, payout policy, cumulative partial refunds, owner profile financial controls, Creator Balance, Preferred policy/renewals, service refunds, review hold/file maintenance, registration hard gate, and store kill switch pass. No later storefront commit materially changed these systems.
- **Environment isolation:** the staging deploy script builds an allowlisted output and explicitly targets `tobacco-road-games-staging`; D1 and R2 bindings are staging-specific. Normal staging uploads use `env.TRG_PRODUCTS`, which is bound to `trg-products-staging`, not production `trg-products`.
- **Private delivery:** paid PDFs are not served through the public `/product-assets/` route. Delivery requires an active entitlement plus a signed credential; object keys come from the runtime delivery mapping.
- **Review Hold:** owner hold blocks browse/checkout/internal-balance/bundle/ad saleability, the Creator cannot clear it, existing entitlements remain, and restore clears only that hold.
- **Sponsor fixtures:** the two Tobacco Road Games test ads are rows only in `trg-orders-staging`, loaded by a script that refuses any other project/database. Production has zero marketplace ads. Click events are generated only by a real click handler; impressions are logged when a creative is rendered.
- **Office:** the public `/office/` redirect remains 307 to the Access-protected Office hostname. It has no marketplace schema or launch dependency.
- **No production transaction history:** production has zero users, orders, order items, entitlements, payouts, ads, and webhook events. The audit performed no transaction.

## I. Known product/storage defect: `circle-of-cinder`

`circle-of-cinder` is a **dormant legacy compatibility record**, not an active listing, fixture currently rendered to customers, generated artifact, or R2-backed product.

Exact provenance:

1. Migration 018 inserted `listing-circle-of-cinder` for the seeded RV Sawyer Creator with lifecycle state `active`.
2. Migration 019 later added `publication_state NOT NULL DEFAULT 'not_approved'`; the existing row therefore became nonpublic.
3. Commit `5a083bd` deliberately cleared `data/products.json`, removed generated product pages, emptied the runtime catalog and product-folder map, and retained the D1 seed only for compatibility/history.
4. The current generated catalog, homepage, store/catalog page, sitemap, and product directory contain no `circle-of-cinder` reference.
5. The current public route `/product-assets/circle-of-cinder/cover.webp` returns 404 in both production and staging before an R2 object can be resolved, because the product-folder map is empty.

Old cached pages, manual URLs, historical documentation, or external links can still request the obsolete asset and produce a harmless 404. Ordinary current navigation cannot produce the request. The stale documentation mapping should be corrected during documentation cleanup, but the record does not require deletion.

**Classification: NO ACTION** for launch behavior; **HARDENING DEBT** for stale documentation/history clarity.

## J. End-to-end coverage

### Customer systems

| Journey | Implementation state | Launch assessment |
|---|---|---|
| Browse/search/product | Static generated storefront and search code exist | Pages load, but catalog has no real products: blocked |
| Guest checkout | Verified-email gate, quote, order creation, Stripe Checkout exist | Production Resend/Stripe absent: blocked |
| Account checkout | Session, verified email, fraud/duplicate checks exist | Production verification/Stripe absent: blocked |
| Free acquisition | Current policy routes acquisition through verified checkout; legacy anonymous route is disabled | Needs a real free launch product and rehearsal |
| PWYW | Pricing/quote paths exist | Needs real product and $0/positive staging rehearsal |
| Paid digital | Pending order, idempotent Stripe session, webhook finalization exist | Live config absent; stale test fixtures red |
| Entitlement/download | Private R2 mapping, entitlement, signed credential, repeat download exist | No launch object/catalog; staging order-access secret missing |
| My Library/recovery | Implemented and authorization-tested | Needs end-to-end staged proof with a real product |
| Duplicate ownership | Active entitlement lookup by account/email hash blocks repeat digital purchase | Implemented; rehearse account and guest cases |
| Ratings | Verified customers rate Creators, not products, by settled policy | Implemented; later Creator-facing use, not product-rating blocker |

### Creator systems

Account creation, identity selection, dashboard, listing intake, file upload, owner publication, promotions/bundles, analytics, finance, payout request, Preferred, Creator Balance, additional identities, review hold, file replacement, and closure all have implementation and substantial automated coverage. Their production provider/scheduler/legal/operations dependencies are not active. They are **not November 28 blockers if public Creator enrollment is held**; they are **not ready for an open Creator rollout**.

### Owner/support systems

The Owner Dashboard, store-state control, order recovery/resend, financial ledger/adjustments, manual payout rail, Listing File Maintenance, Review Hold/Restore, Creator closure visibility, advertising controls, and audit records exist. Production owner access is protected by Cloudflare Access. Staging owner access is not presently configured for rehearsal and is a pre-launch blocker.

## K. Production configuration gaps

No values are included here.

| Name/binding | Staging | Production | Launch role |
|---|---|---|---|
| `TRG_ORDERS` | `trg-orders-staging` | `trg-orders` | Present |
| `TRG_PRODUCTS` | `trg-products-staging` | `trg-products` | Binding exists structurally; launch objects absent |
| `PAYMENT_PIPELINE_STAGE` | `staging` | Not evidenced | Must be `production` before a live key is accepted |
| `STRIPE_SECRET_KEY` | Present, test | Missing from encrypted inventory | Customer paid-launch blocker |
| `STRIPE_WEBHOOK_SECRET` | Present, test | Missing | Customer paid-launch blocker |
| `RESEND_API_KEY` | Present | Missing | Verification/delivery blocker |
| `RESEND_REPLY_TO` | Present | Missing | Verification/delivery blocker |
| `RESEND_WEBHOOK_SECRET` | Missing | Missing | Delivery-state reconciliation gap |
| `RESEND_DELIVERY_ENABLED` | `true` | Not evidenced | Must be deliberately set for order mail |
| `ORDER_ACCESS_SIGNING_SECRET` | Missing | Present | Staging rehearsal blocker |
| `DOWNLOAD_SIGNING_SECRET` | Present | Present | Ready structurally |
| `ORDER_EMAIL_HASH_SECRET` | Present | Present | Ready structurally |
| `CHECKOUT_ACCESS_COOKIE_SECRET` | Present | Present | Ready structurally |
| `GOOGLE_CLIENT_ID` | Present | Missing | Optional only if Google is not promised |
| `FORUM_RATE_LIMIT_SECRET` | Present | Missing | Public forum writes fail closed |
| owner auth/Access config | Fallback login reached; secrets absent | Edge Access works | Staging rehearsal blocker |
| `GITHUB_TOKEN` | Missing | Present | Staging publication blocker |
| `GITHUB_PUBLISH_REF` | Not set; defaults `main` | Default `main` fits production | Must explicitly be `staging` in staging |
| `STRIPE_CONNECT_SECRET_KEY` | Missing | Missing | Later Creator rollout |

No production secret should be copied into staging. Test and live Stripe/webhook credentials must remain separate.

## L. Exact staging launch rehearsal script

Do not run this until RV approves repairs/configuration and the preconditions are complete.

### Preconditions

1. Freeze an approved commit on `staging`; require a clean tree and record hashes.
2. Keep staging store `CLOSED`; do not apply migration 052 as a generic migration step.
3. Configure staging owner auth, `ORDER_ACCESS_SIGNING_SECRET`, `RESEND_WEBHOOK_SECRET`, and staging-only GitHub dispatch with `GITHUB_PUBLISH_REF=staging`.
4. Confirm Stripe key begins `sk_test_`, staging webhook secret is endpoint-specific, and `PAYMENT_PIPELINE_STAGE=staging`.
5. Create one or more clearly marked staging-only digital products through the real owner/Creator intake, upload, validation, publication, generated-catalog, and isolated staging deployment path. Include fixed-price, free, and PWYW coverage if those modes will launch.
6. Confirm staging R2 objects exist at the exact runtime delivery keys and production R2 was not touched.
7. Make the full 68-test inventory green, then run `npm test`, visual storefront tests, and `git diff --check`.

### Customer rehearsal

1. Browse anonymously: homepage, Explore, shelf/search results, product page, creator attribution, support, legal notices, cart.
2. Verify CLOSED state hides/blocks purchase controls server-side while account, library, order access, and downloads remain available.
3. Create an email/password account; verify mail, sign in/out, reset password, and confirm no promotional subscription is created.
4. Exercise Google sign-in if it is in launch scope.
5. Verify guest email code request/confirmation with a new address.
6. Acquire a free item through the current verified-checkout path; confirm order, entitlement, My Library for account purchase, and guest order access.
7. Exercise PWYW at $0, minimum/selected positive price, and invalid price.
8. Open staging deliberately through the owner control for the transaction window.
9. Complete one Stripe test paid purchase as a guest and one as an account, using real test-mode webhooks—not database edits.
10. Verify pending order, paid status, immutable item/split snapshots, one entitlement per item, email outbox/provider ID, order-access link, My Library, first and repeat download.
11. Re-deliver the same Stripe event and verify one webhook record, no duplicate entitlement, no duplicate delivery message, and unchanged financial snapshots.
12. Attempt a duplicate purchase using known account and email ownership; verify rejection and recovery guidance.
13. Verify canceled, expired, failed, delayed webhook, missing-object, and owner repair/resend paths.
14. Submit and update an eligible Creator rating; verify an unverified/noncustomer account cannot rate.
15. Return staging to `CLOSED` and verify the state.

### Owner rehearsal

1. Authenticate through the intended staging owner boundary.
2. Review order, entitlement, email, webhook, financial, and audit records.
3. Exercise repair fulfillment, intentional resend, revoke/regenerate access, and customer remediation without deleting ownership.
4. Place and clear Review Hold; verify checkout, Creator Balance, bundles, promotions, ads, and browse availability respect it while prior download remains valid.
5. Replace a product file through Listing File Maintenance; verify the existing entitlement downloads the new canonical object and sales/earnings remain unchanged.
6. Verify store CLOSED/OPEN/MAINTENANCE controls and audit trail.
7. Verify pre-launch D1 export, R2 manifest, and rollback/close-store instructions.

### Later Creator-rollout rehearsal

Run only after that phase is approved: Creator eligibility, identity selection, listing/upload/publication, sale/analytics/earnings, Connect, exact payout request, owner completion, Preferred external activation and renewals, Creator Credits, additional identity, review-hold remediation, replacement, refunds/disputes, lifecycle scheduler, notices, and account closure.

## M. Future production promotion plan

1. RV approves the launch scope: customer storefront on November 28; Creator enrollment held unless separately approved.
2. Resolve every E-class blocker and obtain approved customer legal/policy copy.
3. Set production store to `CLOSED` before adding catalog objects or live payment configuration.
4. Freeze the approved `staging` commit and require green tests plus a clean tree.
5. Capture a production D1 export/state report and R2 manifest; verify rollback and emergency-close ownership.
6. Complete the isolated staging rehearsal above and record evidence.
7. Reconcile approved staging to `main`. At present there is no delta; future fixes will create one and must be reviewed as a bounded launch PR.
8. Do not apply migration 052 to staging. Production currently has no pending repository migrations. Review any newly added migration separately and apply schema migrations while production remains `CLOSED`.
9. Configure live production Stripe/Resend/forum variables by name, verify domain/sender and endpoint-specific webhooks, and keep Creator-only provider features disabled unless approved.
10. Publish the exact approved launch catalog and private R2 objects while production is `CLOSED`; verify hashes, metadata, product-folder map, generated runtime catalog, and no orphaned items.
11. Allow the normal main-to-production Pages deployment and verify the deployment commit.
12. Smoke-test public browsing, account, guest verification, quote/checkout gating, owner controls, support/legal pages, catalog, object heads, and download authorization while still `CLOSED`.
13. With separate explicit approval, conduct the smallest controlled live payment test; verify webhook, order, entitlement, delivery message, download, reconciliation, and refund/support procedure. Do not fabricate provider state.
14. RV deliberately changes store state to `OPEN` through the authenticated owner control.
15. Immediately verify browse, quote, checkout, webhook, delivery, download, support, logs, and financial reconciliation.
16. If any material check fails, set state back to `CLOSED`; do not roll back customer/order data. Repair or redeploy only after evidence is preserved.

## Audit conclusion

The site is not ready to open today, but the remaining November path is bounded. The core transactional design does not require another architecture pass. The next work should be the specific pre-rehearsal fixes and configuration items in the companion punch list, followed by one disciplined isolated staging rehearsal. Repairs should not begin until RV approves that list.
