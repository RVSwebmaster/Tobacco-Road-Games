# Preferred Creator external and recurring billing

Preferred Creator is a paid service and community-leadership tier. It does not grant operator, moderation, ownership, governance, organic-ranking, or undisclosed advertising authority. Benefits remain the active 90/10 sale split, 22 active listings, five included active product-ad slots, and Preferred dashboard/notices treatment.

## Plans and settlement

The monthly plan is one 12-month commitment containing twelve durable $20 installments. It is not month-to-month membership. Due dates follow the commitment anniversary with calendar clamping. Each paid installment creates one canonical `preferred_creator_fee` service purchase, one Preferred service-revenue entry, and one month of paid coverage. The annual plan is $200 prepaid and creates one year of coverage through the same ledgers.

Stripe is the normal automatic source for monthly installments and remains test-only. The scheduler uses the Creator owner's ready stored Stripe customer/payment-method references, a stable installment idempotency key, and a server-authoritative $20 amount. Annual Stripe payment uses hosted Checkout with a server-authoritative $200 amount. Provider fees remain unknown until authoritative reconciliation; they are never estimated.

Creator Balance is never consumed silently. A Creator may explicitly pay the next outstanding $20 installment or the full $200 annual price when Available Creator Balance covers it completely. The shared reservation/debit transaction prevents split tender and concurrent double spending. The installment's unique durable identity prevents Creator Balance and Stripe from both settling it.

## Failure, grace, and renewal

A failed installment records its attempt, failure state, retry time, outstanding obligation, and a durable Creator notice. Settled marketplace policy provides exactly **7 calendar days after a missed monthly installment** for remediation. Preferred benefits remain provisionally active during those seven days while Stripe retry or an explicit full Creator Balance cure may occur. A failed first installment does not activate Preferred.

`PREFERRED_BILLING_GRACE_DAYS` may be omitted or set to `7`. Any other configured value fails closed; staging or production configuration cannot silently redefine the policy. If the installment remains unpaid at the end of day seven, Preferred benefits suspend, future transactions use Standard rules, and the unpaid installment and 12-month commitment remain in force. Historical records and immutable sale-time commission snapshots are unchanged.

Creators may correct the stored payment method, allow an idempotent scheduler retry, or explicitly cure the full installment with Creator Balance. They may mark a commitment do-not-renew; this does not erase its remaining installments. A new legally binding commitment is not created automatically at month 12. Annual renewal also requires explicit purchase authorization.

Loss of Preferred changes only future behavior to Standard. Sale-time commission snapshots remain immutable, products are not deleted or automatically delisted for a 22-to-20 cap reduction, and additional activations remain subject to current capacity. Additional-Creator-identity coverage stays separate and additive.

Service refunds, proration, early termination penalties, debt collection, and automatic coverage unwind remain unresolved and are not implemented. Production scheduling and production Stripe activation remain disabled.
