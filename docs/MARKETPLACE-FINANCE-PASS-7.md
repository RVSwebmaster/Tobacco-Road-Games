# Marketplace Financial Accounting — Pass 7

## Boundary and fee policy

Customer collection remains the existing Stripe Checkout/webhook system. Creator disbursement is a separate internal liability ledger; Pass 7 does not call a payout provider or store banking/tax identifiers.

The effective marketplace fee is centralized in `creator-finance.mjs`. An operator-recorded, effective-dated row in `marketplace_fee_policies` takes precedence. `MARKETPLACE_FEE_BPS` is the configuration fallback. When neither exists, development uses 1,500 basis points (15%) and marks it as a development default; this is not a published marketplace promise. The reserve window is configured by `CREATOR_PAYOUT_RESERVE_DAYS` and defaults to 14 days. Fixed order and line fee fields are reserved in policy and snapshots; the current calculation applies the percentage and fixed line fee. Allocating a fixed order fee across multiple lines is intentionally deferred until a written allocation rule exists.

Fee-policy changes are append-only effective-dated records with an operator financial audit event. A completed sale snapshots its policy and never uses later policy or catalog changes.

## Sale-time accounting

The verified Stripe paid transition prepares creator sale snapshots and ledger inserts in the same D1 batch that marks the order paid and the webhook processed. Each creator-attributable line records its actual list price, paid unit price, quantity, discount, gross, fee basis points, fee amount, creator net, currency, creator/product/order identities, and sale time. Unique order-item and ledger idempotency keys prevent duplicate accounting during repeated delivery.

Attribution is line-level. Listings resolve through their durable public/source product slug. Published single-creator bundles resolve through `public_bundle_slug`. Lines with no explicit creator relationship are TRG-owned revenue and create no creator liability. Cross-creator bundle splits are unsupported; a future bundle split table must declare equal, percentage, or fixed allocations explicitly.

## Durable ledger and reversals

`creator_earnings_ledger` stores immutable monetary entries for sale earnings, refund or chargeback reversals, manual adjustments, payouts, and payout reversals. Corrections are new entries, not edits to historical amounts. Refund/chargeback support is exposed through `recordOrderReversal`, including proportional partial reversals and provider-event idempotency. Current Stripe handling has no refund/dispute event ingestion, so those provider event types must call this service when that webhook work is added; Pass 7 does not fabricate provider behavior that does not exist.

Entries become available after the configured reserve date. Operators can hold and release eligibility; release restores `pending` versus `available` according to the original availability date. A manual payout cannot exceed the eligible balance, creates a separate payout record, a negative ledger entry, and an audit event. The payout reference is operational text only and must never contain banking credentials.

## Views, statements, tax hooks, and Friday

The creator finance API is membership-scoped and read-only. It reports gross sales, fees, net sale earnings, reversals/adjustments, unpaid, available, held, paid, lifetime earnings, and ledger activity. Monthly CSV statements contain immutable product sale snapshots, quantities, gross, fees, net, ledger adjustments/payouts, and closing unpaid balance.

The owner finance API exposes all creator balances, TRG-owned product receipts, ledger inspection data, reconciliation exceptions, and authenticated mutations for payouts, adjustments, holds, and fee policies. Creator routes expose no ledger mutation action.

Creator profiles now include non-sensitive legal/business-name, payout-profile status, tax-document-required hooks. SSNs, EINs, bank details, withholding workflows, filings, and tax advice remain deferred to a secure third-party provider.

Financial services are UI-independent so Friday can later read balances, statements, and exceptions or prepare a payout batch. Friday must not receive fee-policy, arbitrary-adjustment, hold, or payout authority.

## Reconciliation and recovery

Reconciliation reports without repairing:

- paid creator lines missing sale snapshots or sale ledger entries;
- duplicate sale entries;
- ledger entries referencing missing orders;
- creator liabilities, payouts, holds, and TRG-owned receipts through the operator summary.

On an exception, preserve all records, inspect the paid order, item snapshot, provider event, sale snapshot, and ledger. Add a corrective entry or replay the idempotent accounting service only after identifying the cause. Never rewrite historical sale terms. Automated refund/dispute ingestion, payout-provider integration, payout reversals, provider reconciliation imports, collaborative bundle splits, finalized legal fee terms, and secure tax onboarding are Pass 8+ work.
