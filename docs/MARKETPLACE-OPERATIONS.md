# Marketplace operations boundary

Migration 030 and `marketplace-operations.mjs` provide durable remediation, provider-cost, fraud, payout-request, scheduler-run, audit, and notice records for the Creator and operator dashboards.

The scheduler boundary is manual and idempotent. The notice outbox queues dashboard/email-ready events but has no delivery worker. Refund-required records do not call Stripe. Payout requests reserve ledger-backed eligible balances but never assert an external transfer occurred. Production cron, email delivery, refunds, and payouts remain disabled until separately approved.

Provider refund/dispute costs require an operator-supplied actual cost and explicit `creator` or `marketplace` responsibility. Creator responsibility creates a no-markup negative `manual_adjustment` in the existing immutable Creator ledger; marketplace responsibility creates no Creator ledger debit.
