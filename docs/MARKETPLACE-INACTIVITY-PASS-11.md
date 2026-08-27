# Marketplace Inactivity Lifecycle — Pass 11

Qualifying activity is a recorded paid order line or recorded zero-dollar acquisition associated with the durable creator listing. Views and legacy download-link requests do not qualify. Fixed-price paid lines record `paid_sale`; free lines record `free_acquisition`; PWYW lines distinguish `pwyw_paid` and `pwyw_free`.

The checker uses the latest recorded activity, falling back to immutable first publication for a new product. At exactly 365 days without activity it enters warning, keeps the product available, and sets a 30-day grace end. Activity during grace restores active status. After grace it sets the separate inactivity state to inactive and pauses marketplace publication. Manual pauses and products unavailable for another reason are not selected as inactivity candidates.

Dashboard notices and queued email status share a durable, deduplicated notice table. Warning, seven-day approaching-expiration, warning-cleared, inactive, reactivated, and lifecycle-error notices are idempotent. Email delivery is intentionally queued for the existing email-provider abstraction; dashboard state is authoritative if email is unavailable.

Inactive listings no longer count as published capacity and checkout revalidates database inactivity before creating an order or Stripe Session. No listing, order, ledger, activity, audit, or entitlement is deleted. Existing download authorization and My Library queries therefore remain valid.

Creator reactivation requires ownership, catalog/PWYW capacity, valid pricing, and an accepted delivery file/mapping for digital products. It returns the listing to compliance-revalidation-ready state rather than republishing automatically. Durable identity and first publication are untouched, so expired launch treatment cannot restart. Ad and coupon systems are not yet implemented; their future eligibility must require `inactivity_state='active'`.

`runInactivityCheck` is the idempotent service boundary for a future scheduler, operator command, or Friday. The owner finance API exposes current warnings, recent inactive/reactivated products, and an authenticated operator action to run the checker. Manual lifecycle override UI is deferred; any future override must append publication audit and notice records.

Policy ambiguity retained: a year is implemented as 365 rolling days because canon specifies rolling 12 months but does not define leap-day treatment. Pass 12 should confirm calendar-month versus 365-day semantics before production scheduling.
