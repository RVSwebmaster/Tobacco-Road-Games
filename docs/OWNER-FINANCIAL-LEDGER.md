# Owner Financial Ledger

The operator-only `/owner/finance.html` report is the marketplace's accounting-control view. It separates money owed to Creators from Tobacco Road Games revenue and does not treat internal Creator Balance activity as external cash received.

## Canonical Creator liability

`functions/_lib/creator-liability.mjs` is the canonical current-balance calculation used by Creator Balance purchases, payout requests, payout readiness, manual payout recording, and owner reporting. For each Creator it reports accrued earnings, pending and held funds, internal purchase/service debits, correction credits, active payout and purchase reservations, dispute holds, completed payouts, negative balances, current net liability, and the amount currently eligible for payout.

Marketplace liability is the sum of positive per-Creator obligations. A negative Creator balance is reported separately and is never used to reduce money owed to another Creator.

Migration `039_creator_liability_reservation_integrity.sql` makes purchase and payout reservations mutually exclusive at the database boundary and excludes active dispute holds from both reservation paths. Application prechecks remain useful for clear errors; the triggers are the final race-condition guard.

## TRG revenue

The report separates product commissions from service revenue (Preferred Creator fees, Ad Credits, and additional Creator identities), and separates Stripe-funded activity from Creator Balance-funded activity. Refund/reversal entries reduce recognized revenue. Authoritative processor fees and marketplace-responsible provider costs are shown separately. Unknown fees remain exceptions rather than estimates.

The displayed figures are ledger accounting, not a bank statement. Stripe settlement timing, reserves, transfers in flight, and bank deposits require comparison against provider and bank statements. “Creator Money Required” is the minimum positive Creator liability the operator must be able to support; it is not TRG revenue.

## Trace and access

The report includes product orders, creator allocation, fee, payout state, delivery entitlement, reversals, service purchases, source, recognized revenue, fee authority, coverage/credit effects, and financial audit history. Owner-session authorization protects both the HTML route through the existing owner middleware and the JSON API through signed-session verification. Provider payment references may be used for tracing; raw payment credentials and tax/bank data are not displayed.

## Verification cases

`npm run test:finance-integrity` covers: internal product spending reducing payout eligibility; purchase reservations; competing payout reservations; internal service revenue without external cash; service correction/restoration; non-netted negative Creator balances; and purchase-versus-payout reservation races in both directions.
