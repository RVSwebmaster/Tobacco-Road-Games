# Marketplace Policy Alignment — Pass 10

Pass 10 makes settled policy authoritative in accounting and publication while retaining the existing order, entitlement, ledger, and Stripe boundaries.

## Sale policy precedence

Policy values live in `marketplace-policy.mjs`. For each creator order line, the resolver applies:

1. the one-time 30-day launch rate (10% TRG fee);
2. otherwise an active Preferred term (10% TRG fee);
3. otherwise Standard (20% TRG fee);
4. then an effective TRG promotional policy only when it lowers that fee.

A promotion can never reduce creator share. Each creator sale snapshot stores the durable listing ID and reason (`launch`, `standard`, `preferred`, or `promotional_override`) alongside the actual paid amount and resulting shares. Existing snapshot and ledger idempotency keeps historical results immutable.

## Durable products and first publication

`creator_listings.id` is the durable marketplace product identity; mutable slugs and metadata are not identity. `first_published_at` is populated only on the first completed publication. A database trigger blocks ordinary changes. Corrections use an owner-only service that appends an audited correction record rather than rewriting the original timestamp. Pause, reactivation, edits, and pricing-model changes therefore cannot restart launch treatment.

## Preferred terms and capacity

Preferred terms store monthly-commitment or annual-prepaid cadence, canonical price, start/end, active state, and renewal state. Every term is exactly 12 months. Cancelling renewal does not end the current term. Production billing is not enabled.

Publication enforces 20 active listings and one active PWYW listing for Standard, or 22 and two for Preferred. Draft/paused/unpublished listings do not count. Expiration does not delete or pause overage listings; it blocks the next publication until the creator is within Standard limits. RV Sawyer has an explicit catalog-only owner override. That flag is not read by any promotional allocation system.

## Free and PWYW checkout

Published metadata now carries pricing model, suggested price, and durable identity. The server accepts a customer-selected PWYW amount only for PWYW products and validates it as a non-negative integer cent amount. Positive amounts use the established Stripe checkout and are snapshotted from the actual paid order-line amount.

Zero-dollar free and PWYW orders branch before Stripe Session creation, are marked paid with zero processor and platform revenue, and run through the existing entitlement/fulfillment service. Authenticated acquisitions retain the existing order ownership used by My Library; guest acquisitions retain email-based order recovery. No parallel download system or fake Stripe transaction is created. Store generation routes free-product calls to recorded cart acquisition while retaining the legacy signed endpoint for compatibility with old links.

## Vocabulary

Creator-tool denial now says seller registration is incomplete or restricted. Publication mapping describes marketplace compliance review, covering technical, delivery, pricing, rights/policy, and safety readiness rather than artistic merit. Legacy internal database state names remain for migration compatibility and are not creator policy language.

## Deferred

Production Preferred billing, automated Preferred expiry jobs, seller agreement/rights/AI fields, inactivity automation, coupons, Ad Credits, and advertising rotation remain for later passes. Production Connect and payouts remain disabled.
