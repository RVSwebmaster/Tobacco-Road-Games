# Full site-wide policy and systems audit

## Emergency finance-integrity remediation — 2026-09-01

A targeted owner-finance inspection found that payout readiness used `getCreatorFinance()` without Creator Balance transactions or active purchase reservations. That overstated payout eligibility after internal spending. The manual payout path also lacked a durable shared reservation step, and the owner had neither a non-netted marketplace Creator-liability total nor a complete human-readable finance view.

**RESOLVED.** `creator-liability.mjs` is now the canonical authorization calculation for Creator Balance spending, payout readiness, Creator-requested payout reservation, and manual payout reservation/completion. Migration 039 adds reciprocal database race guards for payout and purchase reservations, including dispute holds. The owner-only `/owner/finance.html` report shows positive Creator obligations without cross-Creator negative netting, TRG product/service revenue, Stripe versus internal activity, costs, transaction traces, audit history, and reconciliation exceptions. The dedicated finance suite verifies the $100 earned / $40 spent / $60 maximum payout case, both reservation directions, service correction, and aggregate negative-balance handling. Full `npm test` and the store kill-switch suite pass. Live provider payout execution and exact bank-statement/Stripe settlement reconciliation remain production operations, not application-ledger defects.

Audit date: 2026-08-31  
Original audited commit: `027d29533963a1f86e0a926bab8192075ffbdda5`  
Post-remediation reread: 2026-09-01 at `588e75b23ff9571ef2f0a0665bfa466c94e435eb`  
Environment: canonical repository and staging; production was not changed  
Store state during audit: staging `CLOSED`

Post-audit remediation: all audit-derived software enforcement findings were reread after migrations 035–038 and the eligibility, service-accounting, identity-billing, Preferred-billing, and service-correction passes. The original detailed matrix remains useful as historical evidence; the current disposition immediately below supersedes its old `PARTIAL`, `MISSING`, and priority labels where they conflict.

## 2026-09-01 post-remediation disposition

### Primary result

**No known audit-derived software or settled-policy enforcement blocker remains before Tobacco Road Games leaves audit-remediation mode.** Remaining work is intentionally deferred, legal-counsel work, production activation/operations, or optional post-launch improvement.

The reread verified the full migration chain through 038, current code and tests, the deployed staging commit, store state, protected routes, and the newer financial/service paths. It found no remediation-introduced authorization bypass, parallel financial ledger, stale payment-source bypass, expiring Ad Credit balance, unsupported Creator money-movement claim, or service-refund conflict with the settled non-refundable-after-service-begins rule.

### Original finding reread

| Original finding | Current classification | Current result |
|---|---|---|
| Sticky Creator eligibility | **NO LONGER APPLICABLE / RESOLVED** | Current operational eligibility is recomputed from account/email, registration/profile, Agreement, payment method, payout readiness, identity entitlement, account state, and audit restriction. Protected Creator mutations and publication enforce it server-side. |
| Stripe-funded Ad Credit accounting | **NO LONGER APPLICABLE / RESOLVED** | Stripe and Creator Balance purchases converge on canonical service purchases/revenue; exactly five non-expiring credits are issued with replay protection. |
| Additional Creator identity billing | **NO LONGER APPLICABLE / RESOLVED** | $10 monthly and $100 annual coverage, both payment sources, dated entitlement, expiry gating, reporting, UI, and webhook replay protection are implemented. |
| Preferred external/recurring billing | **NO LONGER APPLICABLE / RESOLVED** | $20 monthly twelve-installment commitments and $200 annual prepaid service purchases are durable for Creator Balance and test Stripe paths. |
| Preferred seven-day grace | **NO LONGER APPLICABLE / RESOLVED** | Exactly seven calendar days is canonical and enforced in billing state, tier eligibility, retry scheduling, notices, and tests. |
| Creator Balance product/service purchases | **NO LONGER APPLICABLE / RESOLVED** | Full-payment-only atomic reservations, canonical product/service accounting, no split tender, and duplicate/race protections are implemented. |
| Creator service refund/correction mechanics | **NO LONGER APPLICABLE / RESOLVED** | Operator-only corrections are limited to objective TRG-caused errors/service failures, restore the original funding source, reverse service revenue, preserve history, and adjust entitlements explicitly. Live Stripe execution remains a production-operations item. |
| Ad Credit expiration | **NO LONGER APPLICABLE / RESOLVED** | Unused Ad Credits do not expire; only redeemed active slots have the settled 30-day life. |
| Discovery labels | **NO LONGER APPLICABLE / RESOLVED** | Explainable labels, exclusions, suppression, public projections, manual recalculation, and scheduler-safe records exist. Production scheduling is an operations item. |
| Creator reputation/ratings | **NO LONGER APPLICABLE / RESOLVED** | Verified-customer Creator ratings, privacy threshold, self-rating exclusion, moderation, and history are implemented. Product ratings remain intentionally deferred. |
| Launch Week/Founding architecture | **NO LONGER APPLICABLE / RESOLVED** | Cohort/window/badge architecture and operator controls exist; campaign dates and awards are intentional activation decisions. |
| Inactivity lifecycle and six-month audits | **NO LONGER APPLICABLE / RESOLVED** | Idempotent state machines, notices, cure/restriction, reactivation, and manual/scheduler-safe runners exist. Production cron/email are operations items. |
| Defective-product remediation | **NO LONGER APPLICABLE / RESOLVED** | Delisting, 30-day correction, customer refund/wait election, entitlement preservation/replacement, deadline expiry, refund-required state, audit, and UI exist. Live refunds are operations. |
| Payouts/reservations and financial ledger | **NO LONGER APPLICABLE / RESOLVED** | Immutable sale/reversal ledger, holds, negative balances, atomic payout reservations, $10 minimum, failure release, and closure exception exist. Live transfers are operations. |
| Business reporting | **UNDERDOCUMENTED BUT IMPLEMENTED** | Creator sale/ledger/payout reports and unified service purchase/revenue/correction records are durable and operator-visible. Service revenue belongs to TRG rather than Creator earnings, so it is correctly absent from Creator payout statements; feature tests reconcile each newer service type. A consolidated operator export is optional. |
| Verification, registration, publication, limits and PWYW | **NO LONGER APPLICABLE / RESOLVED** | Verified acquisition, current Creator eligibility, direct-route gates, objective publication, 20/22 capacity, PWYW 1/2 limits, sale-time splits and immutable first-publication behavior remain enforced. |
| Advertising-slot mechanics | **NO LONGER APPLICABLE / RESOLVED** | Included/purchased slots, five-for-$5 credits, 30-day redemption, swap-without-recharge, expiration, validation, and fair rotation exist. |
| Store kill switch and operator protections | **NO LONGER APPLICABLE / RESOLVED** | Runtime closure, fail-closed checkout, owner authentication, same-origin and CSRF protections, audit records, and private projections remain operative. |

### Deliberate non-blockers

**INTENTIONALLY DEFERRED**

- Coupon campaigns, coupon-funded Ad Credits, and non-stacking coupon checkout enforcement.
- Split tender and silent/automatic Creator Balance spending.
- Product-level Top Rated until a verified product-rating model exists; written customer reviews.
- Related-account/device clustering, advertiser self-service, and other expressly deferred feature expansions.

**LEGAL COUNSEL**

- Final Creator Agreement clauses, governing law/venue, dispute process, warranties, liability, indemnification, formal IP complaint/counter-notice procedure, privacy/retention/data-processing terms, collection rights, and post-termination license/entitlement duration.

**PRODUCTION OPERATIONS**

- Live Stripe/Connect activation, real refunds/disputes/payouts, provider reconciliation and retry runbooks.
- Production cron and marketplace notice email delivery/monitoring.
- Production bindings/secrets/webhooks, R2 isolation/backups/retention/restore, incident response, and final accessibility conformance testing.

**OPTIONAL POST-LAUNCH IMPROVEMENT**

- General customer order-history UI beyond My Library/recovery.
- Polished owner UI for API-first operations and broader consolidated service-accounting exports.
- Staff invitation/delegation management and finer route-specific staff permissions.
- Bundle/scheduled-sale editing polish, automated image-dimension/moderation checks, and expanded accessibility automation before the separately required final production conformance review.

### Eligibility lapse and automatic delisting

This is a **POLICY-DESIGN QUESTION**, not a demonstrated software bug. Current behavior is coherent: current eligibility blocks new protected activity and publication, while explicit inactivity, audit restriction, fraud, rights/safety, payment-risk, and defective-product processes apply their own proportionate listing consequences. Historical customer access, records, remediation, and financial obligations remain available. Existing policy does not require one universal automatic takedown for every eligibility lapse; different lapse types can reasonably require different consequences.

### Staging verification

- Local `HEAD` and `origin/main`: `588e75b23ff9571ef2f0a0665bfa466c94e435eb` before this documentation update.
- Cloudflare Pages deployment `d1ad01b7-3bda-46cd-83dd-b39464826fa8` reports source `588e75b` on the staging branch.
- Remote D1 lists migration `038_creator_service_refund_corrections.sql` as latest and reports no pending migrations.
- Staging `GET /api/store/status` reports `CLOSED`.
- Unauthenticated Creator overview returns 401; owner finance and Creator Balance endpoints return 403.
- Staging contains two pre-existing paid proof orders and zero service purchases, payout requests, or service-refund corrections; this reread created no business activity.
- Full `npm test`, the store-kill-switch suite, and `git diff --check` passed. Production was not queried, deployed, migrated, or mutated.

## Method and status vocabulary

This audit compared the policy canon, Creator Agreement draft and crosswalk, pass-specific documents, migrations 001–034, public/Creator/operator routes, server services, browser UI, automated tests, and staging protections. A hidden panel or documented rule was not treated as enforcement. Enforcement required a server or database boundary. Production-only operations were not exercised.

Statuses mean:

- **COMPLETE** — represented, enforced, exposed where needed, durable, and covered by an operative path.
- **COMPLETE BUT NOT YET ACTIVATED** — implementation exists but an intentional staging/production switch, date, scheduler, or operational approval is absent.
- **PARTIAL** — a meaningful implementation exists, but one or more required paths are absent or inconsistent.
- **DOCUMENTATION ONLY** — policy exists without operative mechanics.
- **SYSTEM ONLY / UNDERDOCUMENTED** — mechanics exist but current policy/operations documentation is insufficient.
- **DEFERRED BY POLICY** — the authoritative sources expressly defer the feature.
- **MISSING** — neither an adequate implementation nor an intentional deferral satisfies the settled rule.
- **CONFLICTING** — current mechanics can contradict the settled rule.
- **OBSOLETE / DEAD CODE** — retained path is no longer an operative supported flow.
- **NEEDS OWNER DECISION**, **NEEDS LEGAL COUNSEL**, and **NEEDS PRODUCTION OPERATIONS** identify the party or activation needed.

## Original executive conclusion (historical; superseded above)

The marketplace has a substantial, internally coherent staging implementation: secure customer authentication and recovery, verified acquisitions, durable orders and entitlements, Creator registration data, publication review, sale-time economics, Creator Balance, service purchases, advertising slots, remediation state, payout reservations, reporting, discovery, ratings, badges, audits, and operator authentication all have real server/database foundations.

It is not production-ready as a marketplace. The store being closed is correct. The largest blockers are:

1. **COMPLETE — continuing Creator eligibility is re-enforced.** Historical registration completion remains immutable evidence only. A centralized current-eligibility result is recomputed from active account/email, registration/profile, current Agreement, payment method, Connect/payout, identity entitlement, Creator account state, and disabling audit state. Protected mutations and Free/paid publication enforce it server-side; history and remediation access remain available.
2. **DOCUMENTATION ONLY — coupons.** The canon settles campaign scope, one-credit funding, 50% standard maximum, non-stacking, dates, and discounted-price commission treatment. No coupon schema, API, checkout validation, Creator UI, operator override, or audit trail exists.
3. **COMPLETE — paid additional Creator identity mechanics.** One primary identity remains included. Additional identities support server-authoritative $10 monthly or $100 annual prepaid coverage through Creator Balance or Stripe, canonical service revenue, dated entitlement, expiration gating, owner UI, reporting, and webhook replay protection. Preferred remains additive and independent.
4. **PARTIAL — production money movement.** Stripe Checkout is implemented for product payments and test-mode webhooks. Connect readiness, payout requests, reservations, batches, and reconciliation are implemented, but production Connect execution, real payouts, refund calls, chargeback operations, and provider reconciliation activation remain intentionally disabled.
5. **COMPLETE (test/staging mechanics) — Creator service corrections and external Ad Credit accounting.** Creator Balance and Stripe service purchases converge on the unified service-purchase/revenue ledger. Operator-only corrections now enforce the settled narrow TRG-error policy, original-source restoration, canonical revenue reversal, explicit entitlement adjustment, durable audit history and replay protection. Production Stripe refund execution remains fail-closed with the other live-money operations.
6. **COMPLETE BUT NOT YET ACTIVATED — scheduled lifecycle work.** Six-month audits, inactivity checks, remediation deadlines, payout progression, discovery recalculation, and durable scheduler-run records have callable/idempotent boundaries. No production cron is configured. Notice records exist, but the marketplace notice outbox has no production email worker.
7. **COMPLETE — Preferred billing mechanics.** The $20 monthly option is now a durable 12-installment commitment with anniversary scheduling, explicit Creator Balance prepayment, stored-method Stripe charging, retry/remediation state, the settled seven-calendar-day grace period, nonrenewal, canonical service accounting, notices, and scheduler-safe idempotency. The $200 annual plan supports both Creator Balance and hosted Stripe payment. Production activation remains separately blocked.
8. **NEEDS LEGAL COUNSEL — Agreement completion.** The draft correctly isolates counsel placeholders, but governing law, venue, dispute process, liability, warranties, indemnification, IP complaint procedure, privacy/data processing, formal notice, retention, and post-termination license duration remain non-final.

No evidence was found of raw card, bank, KYC, tax-ID, or identity-document storage in marketplace tables or browser forms. No production deployment or production mutation was performed.

## Policy source inventory

| Source | Current role | Audit finding |
|---|---|---|
| `docs/MARKETPLACE-POLICY-CANON.md` | Canonical settled business policy | **COMPLETE as canonical source**, but its header still names historical implementation baseline `8eeb799`; the embedded historical gap register is clearly labeled superseded. Update the header after audit remediation, not by silently rewriting history. |
| `docs/CREATOR-AGREEMENT-BUSINESS-DRAFT.md` | Business-level agreement draft | **PARTIAL / NEEDS LEGAL COUNSEL**. Operational clauses align broadly; expressly labeled legal provisions remain unfinished. |
| `docs/CREATOR-AGREEMENT-POLICY-CROSSWALK.md` | Clause-to-policy/system map | **PARTIAL and stale in places**. It still says production Preferred billing is deferred without recognizing the new explicit Creator Balance service path, and it predates migration 034. |
| Pass 2–14 documents | Historical implementation records | **Useful but noncanonical**. “Deferred” statements must be read at their named baseline; several were later completed. |
| Creator Balance, advertising, discovery, Launch Week/reputation docs | Feature-specific current behavior | **Generally aligned**; explicit deferrals are accurate. |
| Migration constraints and runtime constants | Enforceable policy representation | **SYSTEM AUTHORITY only where aligned with canon**; development defaults do not override published policy. |
| Payment staging work orders | Historical deployment evidence | **Operational history, not current policy**. URLs and proof orders must not be treated as current production state. |

Stale or potentially confusing text:

- The canon’s implementation-baseline header is historical.
- `MARKETPLACE-REGISTRATION-PASS-13.md` calls six-month audits and annual/YTD reports deferred even though Pass 14 later implemented them.
- `MARKETPLACE-POLICY-ALIGNMENT-PASS-10.md` and earlier architecture documents retain now-completed deferrals.
- The crosswalk needs a post-migration-034 update for Creator Balance service payments.
- Advertising documentation correctly retains coupons and service-credit refunds as deferred/missing.

## Original system-by-system audit matrix (historical baseline)

### Customer accounts, checkout, and ownership

| Area | Status | Evidence and finding |
|---|---|---|
| Optional customer account and guest checkout | **COMPLETE** | `account-auth.mjs`, `cart-checkout.mjs`, and guest email verification retain both account and verified-guest paths. Account creation is not required for card checkout. |
| Native and Google authentication | **COMPLETE** | One `users` identity is shared by password and Google credentials; session and CSRF handling are centralized. |
| Verified email for every acquisition | **COMPLETE** | Paid checkout calls `assertVerifiedPurchaseIdentity`; signed-in email must match the account and guests require a valid short-lived verification. Anonymous legacy free download is disabled unless an explicit test-only option is injected. |
| True-free and PWYW-at-$0 | **COMPLETE foundation / PARTIAL catalog activation** | Zero-total cart checkout bypasses Stripe and creates paid/acquired order fulfillment; the direct anonymous free-download path is deliberately closed. Availability depends on a correctly published runtime catalog entry. |
| Duplicate digital purchase prevention | **COMPLETE** | Checkout and Creator Balance routes call `findDuplicateDigitalOwnership` using account and verified-email associations and return My Library/recovery guidance. |
| My Library and order recovery | **COMPLETE** | Account-owned orders, historical claim, signed download credentials, payment-source description, and entitlement status are server-derived. |
| Re-download entitlement | **COMPLETE** | Active entitlement produces repeat short-lived download credentials; download count is informational rather than a limiting counter. |
| Customer profile/address fields | **COMPLETE** | Legal/display name, birthday, phone, avatar, notification preferences, safe Stripe references, and multiple shipping addresses are durable and owner-scoped. |
| Safe payment metadata boundary | **COMPLETE BUT NOT YET ACTIVATED** | Schema stores provider references, brand/last4 and status only. SetupIntent/payment-method collection remains unavailable in production. |
| Order history UI | **PARTIAL** | My Library exposes digital owned items and order references. There is no general customer-facing list covering all physical, refunded, disputed, or service transactions. |

### Creator registration, identity, Agreement, and audits

| Area | Status | Evidence and finding |
|---|---|---|
| Registration data model | **COMPLETE** | Public Creator fields and private legal/business/contact/address data are separated in migrations and response projections. |
| Initial registration hard gate | **COMPLETE** | Active verified account, legal name, public profile, full private details, current Agreement, ready payment method, verified/payout-enabled Connect, and identity entitlement are required before the completion timestamp is written. |
| Continuing hard gate | **COMPLETE** | `getCreatorOperationalEligibility` recomputes current requirements independently of the durable initial-completion timestamp. It returns safe reason codes and remediation destinations. Listing/intake mutations, uploads, publication, bundles, advertising, Creator Balance service spending, Preferred, Ad Credits, and payout requests enforce it. |
| Direct URL/API bypass resistance | **COMPLETE for current supported schema** | Creator routes authenticate, resolve membership/ownership, validate same-origin/CSRF mutations, and enforce current eligibility at server boundaries. Legacy-schema compatibility remains intentionally limited to databases predating the registration schema and is not the deployed schema. |
| Primary identity | **COMPLETE** | One primary per owner is enforced by a partial unique index; entitlement source and ownership are durable. |
| Additional identities | **COMPLETE** | Per-identity monthly and annual coverage periods are funded by full Creator Balance or Stripe service purchases. Current eligibility reads dated coverage rather than trusting a historical billing flag; expiration preserves identity/history while blocking protected operations. Owner and operator views expose safe billing/remediation state. |
| Staff roles versus ownership | **PARTIAL** | `creator_memberships` supports manager/staff-style access while `creator_identity_ownership` defines the legal owner. Staff invitation/delegation management is deferred and route-by-route permission granularity is limited. |
| Duplicate/privilege gaming controls | **PARTIAL** | One-primary constraint, additional billing state, audits, discovery self-exclusion and self-rating ownership checks exist. Related-account/device clustering is expressly deferred. |
| Agreement acceptance | **COMPLETE business mechanics / NEEDS LEGAL COUNSEL** | Versioned affirmative acceptance and supersession are durable. Product declarations cover rights, representation and licenses without AI disclosure. Legal boilerplate remains counsel-only. |
| Six-month audit state machine | **COMPLETE BUT NOT YET ACTIVATED** | Due dates, checks, cure/restriction states, notices, audit history and idempotent runs exist. Production scheduler, outbound audit email, and final cure-duration decision are pending. |
| Historical preservation on restriction | **COMPLETE foundation** | Account/listing restrictions do not delete orders, entitlements, ledger, publication history, or audit history. |

### Intake, publication, catalog, launch, and inactivity

| Area | Status | Evidence and finding |
|---|---|---|
| Private intake and R2 staging | **COMPLETE** | Creator files are private, magic/type/size validated, staged under Creator/listing ownership, and require operator acceptance before a delivery key is assigned. |
| Durable product identity and slug handling | **COMPLETE** | Listing ID is the durable identity; source/public slug mapping is separate. First publication is immutable by trigger with a correction audit path. |
| Objective operator review/publication | **COMPLETE** | Review and publication APIs use authenticated owner mutations, readiness checks, reason/audit records and server-rendered catalog synchronization. |
| Listing edit/pause/reactivate | **COMPLETE** | Creator-owned server routes constrain editable states; inactivity reactivation rechecks off-sale time, capacity, files, pricing and compliance. Historical entitlements remain. |
| Free, fixed and PWYW listing types | **COMPLETE** | Pricing model constraints and server resolution exist; PWYW suggested/selected amount validation uses integer cents. |
| Bundles and scheduled sales | **PARTIAL** | Durable draft bundle/sale structures and some Creator tooling exist. Older docs correctly note incomplete polished editing and that public runtime catalog behavior remains authoritative until operator publication. |
| Catalog capacity 20/22/unlimited owner | **COMPLETE** | `assertPublicationCapacity` uses Standard 20, Preferred 22 and explicit owner catalog override `NULL` cap. Draft/paused/inactive items do not count as published active inventory. |
| PWYW capacity 1/2 | **COMPLETE** | Same server publication boundary counts active PWYW listings and rejects excess. |
| Owner fairness boundary | **COMPLETE** | Owner override is read only by capacity logic. Discovery explicitly excludes owner-identity status and advertising rotation uses slot entries, not owner identity. |
| 30-day launch split | **COMPLETE** | Sale policy uses immutable first publication, Standard 80/20, active Preferred 90/10, Launch 90/10, and lower-fee promotional overrides only. Sale snapshots preserve basis points, fee, net and reason. |
| Relist/edit/reprice reset resistance | **COMPLETE** | First-publication trigger blocks mutation; corrections are separate audited records; reactivation retains original timestamp. |
| Product inactivity | **COMPLETE BUT NOT YET ACTIVATED** | Rolling 365-day activity, 30-day grace, notices, inactivation, capacity release, one-calendar-month off-sale and revalidation are implemented. Manual owner execution exists; production schedule/email delivery does not. |
| Inactivity self-purchase | **COMPLETE as settled policy** | Any legitimate paid order records activity; inactivity intentionally does not apply discovery self-purchase exclusions. |
| Prior purchaser preservation | **COMPLETE foundation / NEEDS LEGAL COUNSEL** | Entitlements and R2 delivery copies persist across listing availability. Formal survival/retention duration requires counsel. |

### Money, Creator Balance, services, refunds, disputes, and payouts

| Area | Status | Evidence and finding |
|---|---|---|
| Stripe product checkout | **COMPLETE BUT NOT YET ACTIVATED** | Hosted Checkout, idempotency, verified webhooks, immutable orders, fees and fulfillment exist in test mode. Public store closure prevents live sale. |
| Sale-time financial ledger | **COMPLETE** | Gross, discount, commission, Creator net, reserve availability, reversals, payouts and audit records are durable and provider-independent. |
| Creator Balance display and spending | **COMPLETE** | Available, pending, held, payout-reserved, purchase-reserved and negative states are distinct. Product purchases are explicit, full-balance, atomic and Stripe-free. |
| Creator Balance concurrency | **COMPLETE** | Database reservation trigger includes available ledger, internal debits/credits, payout reservations and service/product purchase reservations. Frontend balance is not trusted. |
| Creator Balance product refund | **COMPLETE operator primitive** | Internal order refund reverses original seller net/commission, restores buyer balance and revokes entitlement without Stripe. A polished owner UI is absent, but authenticated API control exists. |
| Preferred Creator Balance payment | **COMPLETE** | Explicit $20 next-installment prepayment or $200 annual coverage, service debit/revenue, zero processor fee, commitment/coverage linkage, idempotency and same-installment race rejection are atomic. No split tender or silent balance use. |
| Preferred recurring/external billing | **COMPLETE (test/staging mechanics)** | Twelve durable $20 installments, stored-method Stripe scheduling/retry, explicit full-balance prepayment, $200 annual Stripe/Balance settlement, settled seven-calendar-day grace, nonrenewal, notices, reporting, and replay/race protection are implemented. Production cron and live Stripe remain disabled. |
| Ad Credit Creator Balance payment | **COMPLETE** | Explicit full $5 payment issues exactly five credits and one service-revenue record atomically, with no Stripe call or product GMV. |
| Stripe Ad Credit accounting | **COMPLETE** | Authoritative successful Stripe events now create one canonical `ad_credit_package` service purchase, one matching service-revenue entry, and exactly five credits. Provider-event, Checkout Session, and PaymentIntent references are traceable; webhook and purchase keys prevent replay duplication. |
| Creator service refunds/reversals | **COMPLETE (test/staging mechanics)** | Ordinary service purchases are non-refundable after service begins. Protected operator mechanics correct only documented TRG billing errors or service failures, restore the original funding source, reverse canonical service revenue, preserve the original purchase/history and adjust entitlements only when necessary. Unused Ad Credits persist, do not expire and are not cash-equivalent. Stripe production execution remains fail-closed. |
| Objective product refund policy | **PARTIAL** | Eligibility classification, remediation elections, reversal accounting and operator records exist. Production Stripe refund execution is disabled. |
| Defective-product remediation | **COMPLETE BUT NOT YET ACTIVATED** | Immediate delist, 30-day repair, wait/refund elections, replacement object and deadline processing are durable. Refund-required records do not call Stripe; scheduler/email are not active. |
| Chargebacks/disputes | **PARTIAL** | Webhook/ledger snapshots, holds, provider-cost responsibility and no-markup adjustments exist. Live dispute operations and production provider reconciliation remain disabled. Internal purchases correctly fabricate no card dispute. |
| Negative balances | **COMPLETE business ledger / NEEDS LEGAL COUNSEL** | Negative ledger totals block payout and Creator Balance spending; future earnings offset the deficit; no automatic stored-card/bank collection exists. Final collection procedure needs counsel. |
| Creator-requested payouts | **COMPLETE ledger reservation / NEEDS PRODUCTION OPERATIONS** | $10 minimum, one pending request, closure exception, readiness checks and atomic reservation are implemented. External transfer execution is not enabled. |
| Closure payout | **COMPLETE policy primitive / NEEDS PRODUCTION OPERATIONS** | Account-closure requests can reserve a positive balance below $10. Actual transfer/closure orchestration is not live. |
| Processor/provider costs | **PARTIAL** | Product provider finance and responsibility allocation exist. Internal transactions correctly record zero processor fees. Unified external service processor cost reconciliation is absent. |

### Advertising, discovery, reputation, Launch Week, and badges

| Area | Status | Evidence and finding |
|---|---|---|
| Included ad slots | **COMPLETE** | Standard gets one; paid-current Preferred gets five. Tier downgrade clears excess included-slot occupancy. |
| Ad Credit package and redemption | **COMPLETE** | Five for $5; unused credits persist; one redemption creates one additional 30-day slot; upload does not consume a credit. |
| Slot content swap and expiration | **COMPLETE** | Reassignment keeps activation/expiration and consumes no credit. Expiry deactivates the slot without renewal or another debit. |
| Rotation fairness | **COMPLETE** | Each occupied Creator slot contributes one item; buying slots increases item count, not per-item weight. Owner identity does not receive special weighting. House/event inventory is capped per response. |
| Ad validation and accessibility | **PARTIAL** | Alt text, accepted status, type/magic-byte/size checks and UI labels exist. Exact image dimensions and automated malware/image moderation are deferred. Rotation has reduced-motion/focus behavior in the browser implementation, but no complete independent accessibility conformance audit exists. |
| Dashboard sponsorship distinction | **COMPLETE foundation** | Standard dashboard requests vendor sponsor pool; Preferred requests Creator notices. Approved/date-bounded marketplace ads are required. Production sponsor inventory/business operation is not activated. |
| Coupons funded by Ad Credits | **DOCUMENTATION ONLY** | No schema or mechanics. This is the clearest settled-policy/implementation gap. |
| Discovery labels | **COMPLETE BUT NOT YET ACTIVATED** | Durable snapshots, explainable metrics, confidence adjustment, fraud/reversal/self-purchase exclusions, suppression and operator recalculation exist. Production scheduler/homepage rails are deferred. |
| Creator ratings | **COMPLETE** | Verified acquisition, one editable rating per buyer/Creator, aggregate threshold/privacy, fraud/moderation history and seller-owner self-rating block exist. Written reviews are deferred. |
| Cross-Creator internal purchase treatment | **COMPLETE** | Creator Balance orders are normal paid acquisitions; payment source is not penalized. Existing self/fraud/refund exclusions remain. |
| Badge architecture | **COMPLETE** | Definitions, awards, evidence metadata, expiry/revocation, operator controls and public safe projection are durable. |
| Founding Creator | **COMPLETE BUT NOT YET ACTIVATED** | Cohort/award mechanics and policy qualification exist; actual participant awards and production campaign are not activated. |
| Launch Week | **COMPLETE BUT NOT YET ACTIVATED** | Window/cohort logic, snapshot states and operator configuration exist. Production dates, participant cohort, assets and awards remain unset. |

### Operator, scheduler, storage, staging, privacy, and accessibility

| Area | Status | Evidence and finding |
|---|---|---|
| Owner authentication and mutation CSRF | **COMPLETE** | Owner session cookies, same-origin validation, CSRF, bounded sessions and route middleware protect mutations. Public bypass uses separately scoped signed access. |
| Operator tools | **PARTIAL but broad** | Store state, orders, pricing, publication, reviews, finance, ads, advertising, reputation, discovery, Creator Balance, remediation and fraud/payout operations exist. Several are API-first without polished owner UI. |
| Arbitrary balance transfer prevention | **COMPLETE** | Creator service/product flows are transaction-linked. Owner manual adjustment remains an explicit audited financial operation, not peer transfer. |
| Store OPEN/CLOSED/MAINTENANCE | **COMPLETE** | D1 state, authenticated owner mutation, public status, fail-closed reads, checkout/free-download gating and tests exist. Staging reports `CLOSED`. |
| Scheduler hooks | **COMPLETE BUT NOT YET ACTIVATED** | Idempotent marketplace scheduler and feature-specific runners exist. No production cron/Pages scheduled trigger is configured. |
| Notice/email outbox | **PARTIAL** | Durable customer/Creator/operator notices and dedupe exist. Transactional account/order email providers exist separately. Marketplace notice delivery worker is missing. |
| R2 product storage | **COMPLETE foundation / NEEDS PRODUCTION OPERATIONS** | Private object keys, preflight `head`, signed entitlement downloads, owner publication and archive/staging boundaries exist. Backup/retention/restore policy and broad filename/object inventory remain operational work. |
| Staging isolation | **COMPLETE in configuration** | Staging has separate Pages project, D1 IDs, office D1, avatar bucket, test Stripe stage and staging origin. Product bucket configuration is shared by name and therefore requires strict key discipline; this is an operational risk worth confirming before production. |
| Production isolation | **COMPLETE BUT NOT YET ACTIVATED** | No production deployment occurred; live money movement remains gated. Final production bindings/secrets, migrations, webhook endpoints, cron and runbooks require controlled operations. |
| Public/private projections | **COMPLETE with review caveat** | Creator public APIs omit private registration/provider fields; account and owner responses are authenticated/no-store. Continued schema additions require projection tests to prevent accidental spread-based exposure. |
| Fraud/account blocks | **COMPLETE foundation** | User/email blocks, evidence, active/reversed states, transaction enforcement, discovery exclusions and operator reversal exist. Device/related-account clustering is deferred. |
| Accessibility | **PARTIAL** | Semantic headings, labels, live regions, alt text, keyboard-capable controls, focus/hover pause and reduced-motion handling appear across audited surfaces. There is no end-to-end WCAG audit, automated axe suite, or assistive-technology verification. |

## Original permissions and bypass findings (historical baseline)

### High priority

1. **Completed after audit:** current readiness and historical completion are separate concepts and protected Creator operations now consistently enforce the centralized predicate.
2. Add explicit tests that revoke Agreement acceptance, payment-method readiness, payout readiness, and additional-identity billing after completion and verify every direct API refuses gated activity.

### Medium priority

1. Decide whether coupons remain settled near-term policy. If yes, implement the full durable/non-stacking/discounted-commission system; if no, explicitly mark the canon item deferred rather than leaving documentation-only promised mechanics.
2. Implement additional-identity service billing at the settled $10/$100 prices, including expiry, audit and composability with Preferred.
3. Bring Stripe-funded Ad Credit purchases into the unified service ledger and expose one operator view for both sources.
4. Complete controlled production operations for the settled service-correction path, including live Stripe authorization, reconciliation and runbooks; do not activate it while the store remains closed.
5. Add general customer order history beyond digital My Library.

### Production activation blockers

1. Counsel-final Agreement and privacy/notice/retention procedures.
2. Production payment-method collection and Connect/payout operational approval.
3. Real Stripe refund/dispute/payout execution with reconciliation and retry runbooks.
4. Production cron for inactivity, account audits, remediation, discovery and other deadlines.
5. Marketplace notice email worker and failure monitoring.
6. Confirm production/staging R2 isolation, backup, retention and restore procedures.
7. Complete accessibility conformance testing.

## Automated and staging verification

The repository’s test suite covers account auth, Google UI, guest verification, cart quote and checkout, idempotency, Stripe webhooks, secure delivery, account recovery, forum permissions, Creator registration hard-gate foundations, policy alignment, inactivity, advertising, operations, Creator Balance product/service purchases, Launch Week/reputation, discovery and marketplace passes. The audit also applies the full migration chain to in-memory SQLite in several lifecycle suites.

Required verification for this audit:

- `npm test`
- `npm run test:store-kill-switch`
- clean migration-chain execution through migration 034
- staging `GET /api/store/status` must remain `CLOSED`
- unauthenticated Creator and owner financial/service endpoints must reject access
- no production deploy, migration or state mutation

## Original classification summary (historical; superseded above)

| Classification | Principal items |
|---|---|
| **COMPLETE** | Core account auth, verified paid acquisition, duplicate prevention, library/entitlements, initial registration data, product declarations, publication controls, capacity, launch economics, sale snapshots, Creator Balance product/service settlement, ad-slot lifecycle, ratings, badge foundation, operator auth, store kill switch |
| **COMPLETE BUT NOT YET ACTIVATED** | Public store, Stripe live payments, scheduled inactivity/audits/remediation/discovery, Launch Week/Founding awards, production sponsor inventory |
| **PARTIAL** | Bundles/sales polish, general order history, product refunds/disputes/payout execution, operator UI breadth, notices, accessibility |
| **DOCUMENTATION ONLY** | Coupon campaigns and checkout enforcement |
| **SYSTEM ONLY / UNDERDOCUMENTED** | Some API-first operator tools and newer service-ledger/reporting behavior relative to the older crosswalk |
| **DEFERRED BY POLICY** | Split tender, silent Creator Balance recurrence, written reviews, product ratings, related-device clustering, advertiser self-service |
| **MISSING** | Coupon system; marketplace notice delivery worker; paid additional-identity checkout; general external Preferred self-service flow |
| **CONFLICTING** | None remaining from the sticky Creator-eligibility finding; it was remediated after this audit. |
| **OBSOLETE / DEAD CODE** | Legacy anonymous free-download capability is nonoperative unless a test-only injection enables it; older pass gap registers are historical, not runtime authority |
| **NEEDS OWNER DECISION** | Coupon priority, audit cure duration, production scheduler cadence |
| **NEEDS LEGAL COUNSEL** | Agreement final clauses, negative-balance collection, IP complaint process, privacy/retention, entitlement survival and post-termination license |
| **NEEDS PRODUCTION OPERATIONS** | Live Stripe/Connect/refunds/payouts, secrets/webhooks, cron, notice delivery, R2 isolation/backups, monitoring and incident runbooks |

## Original audit disposition (historical; superseded above)

The continuing Creator hard gate, Stripe Ad Credit service accounting, additional-identity billing, and Creator service-correction gaps were remediated after this audit. Coupon policy and the remaining legal and operational blockers still precede production readiness. Production must remain closed until those blockers are resolved and the remediated system passes the full suite plus direct negative authorization tests.
