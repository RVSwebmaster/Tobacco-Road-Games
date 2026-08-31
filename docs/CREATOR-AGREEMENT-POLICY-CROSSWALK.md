# Creator Agreement / Marketplace Policy Crosswalk

Status: Internal maintenance and audit document  
Agreement audited: `trg-creator-marketplace-agreement`, version `2026-08-27`  
Implementation baseline audited: `3df55958f1da5d9850dd5a86d7c412b84bda016f`

Classifications: **A** agreement-only legal language; **B** marketplace policy; **C** implementation-enforced; **D** operator procedure; **E** counsel-finalized legal provision. “Aligned” means the implemented portion agrees with policy; it does not imply that a deliberately deferred production service is enabled.

| § | Agreement rule | Class | Policy/document support | Implementation and test support | Status |
|---:|---|---|---|---|---|
| 1 | Agreement and parties | A, E | Creator Agreement; policy canon §11 | Versioned acceptance in `creator-registration.mjs`; Pass 13 and agreement-draft tests | Counsel required |
| 2 | Objective registration; full intake gate | B, C | Canon §1; registration and architecture Passes 5/13 | `creator-registration.mjs`, `creator-operations.mjs`, migration 028; hard-gate/onboarding tests | Aligned |
| 3 | Express nonexclusivity | A, B | Canon §11; agreement | No exclusivity, external-price parity, or most-favored-nation enforcement found | Legal-only; aligned |
| 4 | Accurate account data; public/private separation; payment and Connect readiness | B, C | Canon §§1,11; account-auth and registration docs | Registration/profile/Connect/readiness services; Pass 13 and hard-gate tests | Aligned; production payment collection deferred |
| 5 | Creator ownership; limited operational license | A, B, E | Canon §11 | Delivery, public profile, R2 and entitlement services use operational copies only | Counsel required for worldwide scope/duration |
| 6 | Rights, permissions, accurate listings, safe files | B, C, D | Canon §11; registration/publication docs | Listing declarations, validation and publication readiness; Pass 13/publication tests | Aligned |
| 7 | Objective marketplace review, not merit review | B, C, D | Canon §§1,11 | Publication reason taxonomy and safety/file validation; legacy `approved` vocabulary remains internal | Compatibility boundary |
| 8 | 30-day 90/10 launch; later 80/20 Standard; 90/10 Preferred; immutable snapshots | B, C | Canon §3; finance Passes 7/10 | `marketplace-policy.mjs`, immutable sale snapshots/ledger; Passes 7/10 | Aligned |
| 9 | Preferred price, annual commitment, benefits and expiry | B, C | Canon §2; policy-alignment Pass 10 | Preferred term/capacity/split/advertising reads implemented; production billing and automated expiry execution deferred | Compatibility boundary |
| 10 | One free primary identity; paid additional identities; additive Preferred | B, C | Canon §2; registration Pass 13 | Ownership/entitlement schema and registration service; Pass 13 | Aligned; production recurring billing deferred |
| 11 | Standard 20 / Preferred 22 active listings; vacated capacity reusable | B, C | Canon §§2,8 | `marketplace-policy.mjs`; publication and inactivity services; Passes 10/11 | Aligned |
| 12 | Rolling activity, 30-day grace, mandatory delisting, one-calendar-month wait, compliant relisting | B, C, D | Canon §8; inactivity Pass 11 | `product-inactivity.mjs`; migration 024; Pass 11 tests, including relisting wait | Aligned |
| 13 | PWYW caps, suggested price, $0 acquisition records, positive amount split | B, C | Canon §9 | Runtime pricing, checkout/free fulfillment, activity service, capacity policy; cart/Passes 10/11 | Aligned |
| 14 | Included ads, Ad Credits, no performance guarantee | B, C | Canon §§4–6; advertising Pass 12 | Advertising/rotation services, migration 025; Pass 12 | Aligned; production service billing remains gated |
| 15 | Verified email for every acquisition; guest account optional | B, C | Canon §16 | Guest-email verification and checkout policy; migration 029; transaction/checkout tests | Aligned; store remains closed |
| 16 | Known owner cannot repurchase; recovery/download instead | B, C | Canon §16 | `findDuplicateDigitalOwnership` in checkout; entitlement and recovery services; transaction/customer-delivery tests | Aligned |
| 17 | Objective refund eligibility only | B, C, D | Canon §17 | Refund reason taxonomy in `transaction-policy.mjs`; targeted policy tests | Aligned; operator adjudication procedure |
| 18 | Immediate delisting, customer choice, 30-day repair and mandatory waiting-customer refund | B, C, D | Canon §17 | Remediation/choice tables and `openProductRemediation`; automated notifications, deadline processing, and complete operator/customer UI not implemented | Implementation gap |
| 19 | Original split reversal and responsibility-based provider refund cost | B, C, D | Canon §17; finance/provider Passes 7/8 | Immutable proportional reversals implemented; provider refund-cost responsibility ledger/allocation not yet implemented | Implementation gap |
| 20 | Responsibility-based disputes; open funds held; no markup | B, C, D | Canon §17; provider-finance Pass 8 | Dispute holds and explicit responsibility-aware reversals; Pass 8 | Aligned for transaction loss; provider-fee allocation remains a gap |
| 21 | Confirmed-fraud account/email blocks; supporting signals; reversible false positives | B, C, D | Canon §17 | Fraud-block schema and checkout enforcement exist; operator create/reverse workflow and signal ingestion are not complete | Implementation gap |
| 22 | Negative balances; no automatic card/bank collection; future earnings offset | B, C, E | Canon §18; finance Pass 7 | Single immutable ledger and negative-balance reporting; payout readiness blocks nonpositive funds | Aligned; separate collection terms require counsel |
| 23 | Creator-requested payouts; $10 minimum; one pending; failed funds preserved; fees absorbed | B, C, D | Canon §18; Connect Pass 9 | Payout-request service/schema and readiness checks; external payout execution and Creator-facing request route remain disabled | Compatibility boundary |
| 24 | Closure pays positive eligible balance below $10 | B, C, D | Canon §18 | Payout service supports `account_closure` minimum exception; integrated account-closure workflow not implemented | Implementation gap |
| 25 | Business records, not tax preparation | B, C | Canon §§11–12; audits/reporting Pass 14 | Monthly, YTD and annual reporting from immutable snapshots/ledger; Pass 14 | Aligned |
| 26 | Six-month objective account audits and cure | B, C, D | Canon §12; audits/reporting Pass 14 | Audit state machine, migration 027, owner/Creator reporting; Pass 14 | Aligned; production scheduler/email deferred |
| 27 | Preserve prior-customer access after withdrawal/delisting/termination | B, C, D, E | Canon §§8,11; finance and delivery docs | Entitlements survive listing lifecycle and secure delivery uses retained copies; exact post-termination retention requires counsel | Counsel required; aligned foundation |
| 28 | Rights-complaint investigation and temporary restriction | B, D, E | Canon §11 | Operator publication/restriction controls exist; formal complaint/counter-notice procedure deferred to counsel | Counsel required |
| 29 | Indemnification business intent | A, E | Agreement only by design | No application enforcement appropriate | Counsel required |
| 30 | Fraud, rights, malware, payment-risk and legal suspension | B, C, D | Canon §§11–12 | Publication, audit, fraud and operator restriction services | Operator procedure |
| 31 | Termination survival for entitlements, records, disputes and fraud | A, B, C, E | Canon §11 | Immutable financial/audit records and entitlement foundations | Counsel required for scope/duration |
| 32 | Independent seller; no employment/agency relationship | A, E | Canon §11 | No application enforcement appropriate | Legal-only |
| 33 | Prospective changes; no historical fee recalculation | B, C, E | Canon §3 | Effective-dated policy and immutable sale snapshots | Aligned; reacceptance mechanism exists |
| 34 | Nonoperative marketplace philosophy quotation | B | Public About section and agreement | Exact quote/attribution covered by agreement and marketplace tests | Aligned |
| 35 | Reserved legal boilerplate | E | Agreement only by design | No application enforcement appropriate | Counsel required |
| 36 | Versioned affirmative acceptance | A, B, C, E | Registration Pass 13 | Agreement acceptance table/service, current-version readiness and audit checks | Aligned; final wording requires counsel |

## Compatibility boundaries retained

- `marketplace_status='approved'` and `publication_state='approved'` remain legacy internal compatibility values. Current registration completion, entitlement, payment, payout, declarations, and compliance gates prevent those words from acting as artistic approval.
- Production Stripe payment-method collection, recurring Preferred/additional-identity billing, and external Connect payout execution remain intentionally disabled or incomplete. Policy and ledger readiness must not be represented as money-movement readiness.
- Test-injected catalogs bypass verified-purchase checks only inside checkout unit-test dependency injection. Deployed checkout has no such injected catalog and enforces verification.
- The legacy direct-free-download service is disabled by default; its anonymous path exists only behind the explicit `allowLegacyAnonymousAcquisition` test option.

## Open implementation gaps (no new policy decision required)

1. Complete operator/customer remediation UI, notifications, and deadline processing for the 30-day defect workflow.
2. Record and allocate actual provider refund/dispute fees by established responsibility, without markup.
3. Add authenticated operator create/reverse actions for fraud blocks and integrate proportionate risk signals.
4. Add the Creator-facing payout-request and account-closure workflow only when external payout execution receives operational approval.
5. Activate production audit scheduling and outbound notices only after the existing operational approvals.

No business-policy question requiring a new owner decision was found. Counsel decisions remain those explicitly marked in the Agreement.
