# Additional Creator identity billing

One primary Creator identity is included for each qualifying seller account and never requires an additional-identity fee. Every additional separately owned Creator identity requires its own current paid coverage: $10 for one month or $100 for one prepaid year. Preferred Creator status is a separate additive service and neither payment substitutes for the other.

## Coverage and settlement

Each successful payment creates one canonical `additional_creator_identity_fee` service purchase, one matching TRG service-revenue entry, and one dated identity coverage period. Monthly and annual plans use distinct service SKUs. Early renewal begins at the current paid-through boundary, preserving existing prepaid time and avoiding overlap; changing plans applies prospectively without proration.

Creator Balance payment requires the full fee in Available balance. It uses the shared reservation and service-debit transaction architecture, records an authoritative $0 processor fee, extends coverage atomically, and never invokes Stripe. Split tender is unavailable.

Stripe payment uses hosted test-mode Checkout and the verified webhook processing lease. The server fixes the identity, plan, price, duration, and owner. Successful paid events record safe event, Checkout Session, and PaymentIntent references. Replay cannot duplicate service revenue or coverage. Failed, expired, unpaid, mismatched, or forged-price events grant no coverage. Stripe processor fees remain unknown until authoritative provider reconciliation supplies them; fees are never estimated.

## Expiration and remediation

Current eligibility reads dated coverage for each additional identity independently. When coverage expires, protected operations are blocked even if registration was completed historically or Preferred remains active. The primary identity is unaffected. The additional identity, public/profile history, listings, sales, customer entitlements, ledger, and reports are preserved. Existing listings are not automatically delisted because that broader policy question remains unresolved.

Owners retain account billing controls, Creator Balance visibility, Stripe payment access, profile/account correction, and historical reporting. Staff membership does not grant ownership billing authority. The account view shows every owned identity, included versus additional status, current plan, paid-through date, Preferred status separately, and monthly/annual payment choices.

## Reporting and unresolved refunds

Creator reporting identifies the service type, plan, coverage dates, amount, payment source, and settlement state. Operator reporting includes owner, identity type, plan, coverage, provider references, processor-fee authority, payment source, and separate monthly versus annual revenue totals. Identity fees remain outside product GMV, Creator earnings, Preferred revenue, and Ad Credit revenue.

No automatic proration, mid-period refund, coverage unwind, or used-service refund policy is introduced. Future authorized reversals can use the canonical reversed service state, but service-refund eligibility remains an owner policy decision.

No additional Creator identities existed in staging when migration 036 was prepared, so no billing charges, coverage, or revenue were backfilled.
