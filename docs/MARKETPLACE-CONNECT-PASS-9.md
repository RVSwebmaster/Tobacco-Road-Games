# Marketplace Connect — Pass 9

Pass 9 is a sandbox proof of concept. Stripe Connect is available only with an `sk_test_` key and a non-production payment stage; live keys and the production stage fail closed. TRG uses Stripe-hosted Express onboarding and fixed server-generated refresh/return paths. The creator never supplies a redirect target.

## Data and onboarding boundary

TRG retains the opaque Connect account ID plus summarized operational state: account existence, details submitted, charge and transfer capability, payouts enabled, number of requirements due, a short disabled-reason category, onboarding/verification state, country, and settlement currency. It does not retain identity documents, tax forms, KYC payloads, SSNs/EINs, bank or routing numbers, or onboarding URLs.

A manager of a creator record can create one account, resume hosted onboarding, and refresh status. Replacing a non-empty provider account reference is rejected; account migration needs a dedicated future workflow. Account creation, link creation, status synchronization, batch preparation, approval, and cancellation are audited without sensitive provider payloads.

## Readiness and reconciliation

Connect readiness and TRG policy readiness are independent. Active transfers and enabled payouts do not override internal holds, minimums, reserves, ledger reconciliation exceptions, or provider-finance exceptions. A provider restriction blocks payout eligibility while leaving the creator balance and selling eligibility intact.

Operator-triggered Connect reconciliation reads Stripe test state and reports missing accounts, capability differences, restricted-but-internally-verified accounts, and currency differences. It does not repair or mutate either system. Existing payment, refund, and dispute reconciliation remains separate and continues to gate payout readiness.

## Payout batches and execution boundary

Preparation snapshots currently eligible creators into a proposed batch without creating payout ledger entries or calling Stripe money-movement APIs. Batches support `draft`, `ready_for_review`, `approved`, `cancelled`, `execution_pending`, `executed`, `partially_failed`, `failed`, and `reconciled`. Items independently support proposed, ineligible, pending, executed, failed, and cancelled outcomes so one failure does not erase successful results.

Approval changes state only. External execution is deliberately implemented as a hard-disabled service boundary. A future executor must revalidate every item after approval, record the provider result per item, write ledger payouts only for verified executions, and reconcile the result. Manual payout recording remains available for already-confirmed external transfers and still uses the provider-independent ledger.

Friday may read readiness, refresh status, run reconciliation, explain blocks, and prepare a batch. Friday may not change payout destinations, account ownership, holds, fee policy, immutable history, approve batches, or execute payouts.

## Future collaborative bundle splits

Use immutable, effective-dated split versions rather than values inferred at payout time:

- `bundle_split_versions`: bundle ID, version, allocation mode (`percentage` or `fixed`), currency for fixed allocations, creator approvals, operator approval, effective timestamps, and immutable activation metadata.
- `bundle_split_items`: version ID, creator ID, basis points or fixed cents. Percentage items must total exactly 10,000 basis points; fixed items must total the bundle allocation amount in one currency.
- Every order line snapshots the selected split version and each creator's gross allocation, fee, reserve, and net earning at sale time.
- Catalog-price-derived splits are permitted only as an explicit, creator-approved rule; they are never the implicit default.
- Changing a split creates a new version and cannot rewrite prior sales or ledger entries.

## Deferred to Pass 10

Production enablement, account migration, webhook-driven Connect status refresh, persistent reconciliation-run history, revalidation between approval and execution, owner-only sandbox execution, per-item provider references, verified ledger posting, retry/idempotency policy, and production operational controls remain intentionally deferred. Development fee, reserve, and minimum values remain configurable defaults rather than public business policy.
