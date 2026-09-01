# Creator service refunds and corrections

Creator-facing marketplace services are non-refundable once the purchased service or entitlement begins. Change of mind, non-use, voluntary inactivity, unused benefits, ending Preferred, identity expiration, or lack of advertising results are not refund grounds.

Tobacco Road Games corrects genuine TRG billing mistakes and service failures. Operator-authorized categories are duplicate charge, incorrect amount, service not delivered, TRG system failure, and another documented TRG-caused error. The operator must identify the original service purchase, document the reason, specify the exact correction amount, and explicitly choose any necessary entitlement correction. There is no Creator self-refund endpoint and no general proration tool.

## Payment and accounting

Creator Balance-funded corrections atomically create one positive `operator_correction` transaction, one negative service-revenue reversal, any explicit entitlement correction, and durable correction/audit records. The database prevents aggregate correction amounts from exceeding the original charge. Stripe-funded corrections require the original PaymentIntent and a stable refund idempotency key. Only staging/test Stripe refunds are enabled; production refund calls fail closed. Provider-pending or uncertain outcomes reserve the correction amount and do not prematurely reverse revenue or entitlements.

The original service purchase and revenue entry remain preserved. A full completed correction marks the purchase reversed; a narrowly documented partial billing correction leaves it settled and records only the corrected amount. Product orders, GMV, Creator earnings, and immutable sale-time commission snapshots are unaffected. Processor fees are never estimated.

## Entitlements

Preferred and additional-identity coverage is left intact unless the operator explicitly reverses coverage to correct the TRG error. Coverage reversal requires correction of the full original charge. No ordinary mid-period proration or cancellation refund exists.

Unused Ad Credits do not expire, are not cash-equivalent, and are not refundable for non-use. A full invalid-package correction may remove still-unused credits. When TRG fails to provide a redeemed slot service, an operator may restore the affected credit or extend the purchased slot by documented days; removing an ad, swapping creative, or receiving no impressions, clicks, or sales is not failure.

Account closure, do-not-renew, eligibility loss, service expiration, or inactivity never automatically creates a refund or cash conversion. Refunds, service restoration, and historical records remain visible to operators through the protected service-purchase report.
