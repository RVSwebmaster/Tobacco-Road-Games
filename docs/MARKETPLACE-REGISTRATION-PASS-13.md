# Marketplace Registration and Account Enforcement — Pass 13

Migration 026 separates private customer profile data, privately owned saved addresses, safe Stripe charge-method references, public Creator identity, private seller registration, legal ownership, staff membership, agreement acceptance, and product declarations. The authenticated `/api/account/addresses` boundary creates, updates, and removes only the signed-in customer's addresses. Existing `marketplace_status` values remain as compatibility data; `registration_status` is the objective account state exposed by creator tools.

One user may own one free primary Creator identity. Additional identities require an explicit current billing entitlement and use a service boundary that is not exposed as fake production billing. Manager/editor/analyst membership remains authorization only and grants no ownership entitlement. Existing Creator records, including RV Sawyer, are conservatively backfilled from an existing manager membership as legacy primary identities.

The current agreement identifier is `trg-creator-marketplace-agreement`, version `2026-08-27`. Acceptances are immutable and a newer version can supersede prior acceptance. Every listing submission records affirmative rights, accurate-representation, and third-party-license declarations. No production-method or AI disclosure field exists.

Creator registration must be fully complete before product intake or listing tools become available. Completion requires the verified active customer account and required account information, complete public/private Creator registration, the current agreement, Connect onboarding with verified/enabled payouts, a ready Stripe-hosted payment method, and active identity entitlement. This intake gate applies equally to paid, Free, and PWYW products. Product declarations and ordinary listing compliance remain later per-product requirements.

Post-audit clarification: the completion timestamp is historical evidence, not a permanent authorization grant. Current operational eligibility is recomputed from current requirements for every protected Creator operation. Ineligible Creators retain safe history and remediation access; see `CREATOR-CURRENT-ELIGIBILITY.md`.

Deferred: production SetupIntent/payment-method collection UI, additional-identity billing checkout, staff invitations, full registration UI polish, six-month audits/cure periods, annual/YTD reports, and final legal agreement prose.
