# Tobacco Road Games Marketplace Policy Canon

Status: Canonical business policy, updated after Pass 12

Implementation baseline: `8eeb799 Remove public AI philosophy statement`
Audience: internal product, policy, and engineering work

This document is the authoritative source for settled Tobacco Road Games marketplace policy. Implementation notes and temporary development defaults do not override it. Items explicitly marked unsettled must not be invented during implementation.

## 1. Accounts and seller registration

TRG supports guest customers, registered customers, and registered sellers/creators. Guest checkout remains intentionally supported, and registered customers may authenticate through existing supported methods, including native credentials and Google login.

- Guest checkout remains intentionally supported. A customer may buy by card and receive legitimate delivery without creating an account.
- A normal customer account may contain real/legal name, email, optional shipping addresses, optional birthday, optional public display/profile name and avatar, Stripe-hosted saved-payment-method references, order history, My Library/entitlements, notification preferences, and recovery/verification support.
- A customer account is not automatically a seller account. Seller registration upgrades an ordinary customer account into a Creator account.
- Creator registration requires a public Creator name and slug/handle, short public bio, optional logo/avatar/banner, legal name, business name when different, business type, country, state/region, mailing/business address, contact email, optional phone, Creator Agreement acceptance, confirmation of sufficient rights to sell submitted material, Stripe Connect onboarding status, and a valid Stripe-hosted payment method.

Seller registration is onboarding, not an application or artistic merit review. Creator registration must be fully complete before product intake or listing tools become available. This includes payment-method and payout onboarding readiness and applies to paid, Free, and PWYW intake. Product review is separate and evaluates legality, seller rights, accurate representation, technical safety, delivery integrity, and marketplace-policy compliance—not taste, ideology, artistic merit, technology, or production method.

No AI-use disclosure is required in seller registration, the Creator Agreement, listing declarations, creator profiles, or marketplace compliance review. TRG does not police production-method ideology.

## 2. Fees, catalog capacity, and Preferred Creator

There are no listing fees. TRG earns revenue when creators earn revenue.

| Account | Active catalog capacity | Included active public product ads | PWYW capacity | Dashboard sponsorships |
|---|---:|---:|---:|---|
| Standard / Free Creator | 20 | 1 | 1 | One outside-vendor banner placement |
| Preferred Creator | 22 | 5 | 2 | None |
| RV Sawyer | Unlimited catalog capacity | Fair access under the same promotional rules | Subject to published promotional fairness | Owner status grants no scarce promotional priority |

Draft, paused, and inactive listings do not consume active catalog capacity. Catalog capacity is distinct from scarce promotional shelf space.

Preferred Creator is a paid service tier, not a merit or performance status. It has no sales requirement or arbitrary cutoff. It is sold as one annual term through either:

- $20 per month for a 12-month commitment; or
- $200 paid upfront for the year.

The monthly choice is payment cadence for the annual commitment, not a seasonal month-to-month subscription. Cancellation stops renewal; benefits last through the paid or committed term.

Preferred benefits are a 90/10 creator/TRG split while active, 22 active listings, five active public product ads, no outside-vendor creator-dashboard ad, and additional promotional consideration where applicable. Marketplace-wide holiday and special promotions remain available to all creators.

One seller registration includes one primary Creator account/profile free. Additional Creator accounts are available for genuinely separate public identities or brands at $10 per month or $100 per year prepaid per additional account. Each is a separate marketplace identity with its own profile and ordinary account-level entitlements. Preferred fees apply in addition when an additional account is Preferred. Additional identities are an account-management option and anti-gaming control, not a promoted growth product; aliases must not multiply free catalog, ad, PWYW, promotional, or other account-level benefits.

Every primary or additional, Free or Preferred Creator account must maintain a valid Stripe-hosted payment method. It may support marketplace purchases, Ad Credits, Preferred billing, additional-account fees, and future creator-side paid services. TRG stores only safe provider references and basic display metadata such as card brand and last four where appropriate, never raw payment credentials.

## 3. Marketplace revenue splits

Each genuinely new durable product identity receives one 30-day launch period:

- creator: 90%;
- TRG: 10%.

After that one-time period, the standard split is creator 80% / TRG 20%. While Preferred status is active, future sales use creator 90% / TRG 10%.

The launch clock belongs to the durable product identity. It never restarts after delisting, relisting, renaming, slug or cover changes, file updates, dashboard changes, inactivity, or reactivation. Only a genuinely new product identity receives a new launch period.

Every sale must snapshot the applicable split and its reason at sale time. Later status or policy changes never rewrite historical sales.

TRG may run marketplace-wide events that voluntarily reduce TRG’s share, including a 90/10 event. Such events must not reduce creator revenue. TRG must not apply sitewide price discounts to creator products without creator opt-in. Event selection and sale-time snapshots must be durable and auditable.

## 4. Public promotional rotation

The public banner sits directly below primary navigation in a fixed area. It shows one fully clickable ad at a time, fades in, remains for approximately two minutes, fades out, and loads the next ad. It does not scroll horizontally or cause layout shift. It pauses appropriately for hover/focus, respects reduced-motion preferences, and pauses while the page is inactive where practical.

Ordinary creator ads promote an individual product, bundle, sale, or other eligible product-specific offer; they are not primarily generic profile ads. Creator identity may appear, but the usual destination is the advertised offer. TRG may include house ads, but house inventory must not become unlimited hidden priority that crowds creators out.

TRG supplies rotation capacity, specifications, examples, upload guidance, and validation/preview tooling. Creators create and upload their own compliant ads and associate them with eligible products. TRG is not an advertising, design, or copywriting agency.

Standard creators receive one simultaneously active product ad; Preferred creators receive five. Creators may prepare creative for every eligible listing and change which ads occupy their slots. No tier promises impressions, frequency, clicks, sales, conversions, or a fixed interval.

## 5. Dashboard sponsorships

A Free Creator dashboard contains one clearly labeled outside-vendor sponsorship banner in the public banner’s general top position, using the same calm fade behavior. It does not show internal creator-product advertising. Preferred dashboards are ad-free.

Dashboard inventory is targeted sponsorship, not low-quality generic display advertising. Suitable sponsors provide legitimate goods or services useful to game creators, publishers, manufacturers, or sellers—for example printing, POD, dice, conventions, fulfillment, creative software and services, licensed stock art, crowdfunding, accounting, shipping, or packaging.

TRG rejects predatory, deceptive, fear-based, spammy, gambling, crypto, get-rich-quick, unrelated, trust-degrading, and creator-migration advertising from direct marketplace competitors. TRG retains final advertiser and creative approval. Private creator information is not used for behavioral targeting without a future explicit policy and consent framework.

## 6. Ad Credits

Ad Credits are sold in packs of five for $5. One credit activates one additional active public product-ad slot for 30 days. The clock begins at activation, not purchase. Unused credits do not expire unless later policy explicitly changes that.

Purchased slots stack with included slots, and a creator may change the eligible product ad occupying a purchased slot during its active period. Purchased and included slots have equal rotation weight unless a future, explicitly distinct premium product says otherwise.

## 7. Coupons

Creators may create campaigns for one product, selected products, or their catalog; choose a discount within TRG guardrails; choose start/end dates; and choose public or creator-shared distribution. One Ad Credit funds one coupon campaign for one month.

Only one coupon may apply to a product in a checkout. Different products in the same checkout may each use their own coupon. TRG controls code generation, validation, expiration, checkout enforcement, minimum-price rules, maximum discounts, and abuse controls.

The standard maximum discount is 50% unless an operator approves otherwise. The creator bears the chosen discount. TRG calculates its percentage from the actual discounted sale price; coupons do not independently alter the marketplace percentage.

## 8. Listing lifespan and inactivity

Listings do not expire arbitrarily while commercially active.

- A paid listing remains active with at least one legitimate sale in a rolling 12-month period.
- A free listing remains active with at least one legitimate download/acquisition in a rolling 12-month period.
- A PWYW listing may qualify through either legitimate paid activity or legitimate acquisition activity.

After 12 consecutive months without qualifying activity, the listing enters an inactivity-warning state and the creator receives dashboard and email notice. A 30-day grace period follows. During grace, the creator may leave it alone, promote it, coupon it, revise it, or create qualifying activity. TRG does not police a creator’s legitimate self-purchase; a legitimate sale is a sale.

With no qualifying activity by the end of grace, the listing becomes inactive: it leaves the active catalog and ad rotation, becomes unavailable for new sales, stops consuming active capacity, and remains visible in the creator dashboard. Historical buyers retain all legitimate orders, entitlements, and access. The creator may later reactivate it if capacity is available. Reactivation never restarts the launch split. Preferred status gives no inactivity exemption. Exact reactivation workflow details remain unsettled.

## 9. Free and Pay What You Want products

A true $0 acquisition never uses Stripe. It records the acquisition as appropriate and creates account/library entitlement where applicable through the legitimate secure-delivery mechanism.

PWYW products require a creator-set suggested price and count toward active catalog capacity. Standard creators may have one active PWYW product; Preferred creators may have two. A $0 choice follows free acquisition; an amount above $0 uses normal Stripe payment and applies the marketplace percentage to the amount actually paid. Switching between fixed-price and PWYW never restarts the launch period.

## 10. Fairness principle

RV Sawyer may use unlimited catalog capacity as marketplace owner, but receives no larger share of scarce promotional shelf or banner space for that reason. Promotional tools and perks created for creator use must be available to other creators under the published rules.

**Unlimited owner catalog capacity. Fair access to scarce promotional space.**

## 11. Privacy, rights, content, and agreements

Public Creator fields are the Creator name, profile slug/handle, short bio, and any supplied logo/avatar/banner. Legal identity, business details, address, contact details, provider references, agreement records, and operational status are private. Stripe remains the system of record for sensitive identity, KYC, tax, bank, and payment information. TRG must not store raw card numbers, bank credentials, SSNs/EINs, identity documents, or comparable sensitive material when Stripe can hold it.

The Creator Agreement must cover legal capacity; accurate account/business information; permission for TRG to market, sell, display, deliver, and maintain customer access; creator retention of IP except where separately agreed; only the operational license TRG needs to run the marketplace; creator responsibility for rights/licenses; marketplace fees and splits; refund, chargeback, and payout treatment; catalog, PWYW, advertising, and inactivity rules; suspension/removal for legal, technical, fraud, malware, rights, or marketplace-policy reasons; preservation of legitimate historical entitlements; and that TRG is not the creator’s employer, partner, agent, attorney, accountant, or tax preparer.

Each product-level declaration must confirm sufficient rights to sell, accurate representation of what the customer receives, and seller responsibility for required third-party licenses and attributions. It must not request AI-use disclosure.

TRG does not prepare or file creator tax returns. Stripe handles the identity, tax, KYC, payout, and reporting functions belonging to Stripe Connect. TRG provides business records: annual gross sales, TRG fees, refunds/chargebacks, net payouts, monthly statements, and year-to-date totals. These records are not tax preparation.

## 12. Creator account operational audit

Every Creator account undergoes a light operational audit every six months, separate from the rolling 12-month product inactivity lifecycle. The audit is not re-application and does not evaluate artistic quality or ideological merit. It checks valid contact email, valid payment method, payout status where required, current Agreement acceptance, unresolved fraud/chargeback/policy issues, tier-entitlement accuracy, current additional-account billing, and obvious duplicate-account or privilege-gaming abuse. Fixable issues receive a reasonable cure period before account restriction.

## 13. Implementation gap register at baseline `8eeb799`

The following are compatibility findings, not authorization to implement them in this policy pass.

### Existing behavior that conflicts with canon

- Creator access still depends on a legacy `marketplace_status='approved'` value. Public copy has been reframed, but durable state should express registration/compliance eligibility rather than artistic approval.
- Creator listing review uses broad “Approve” language. Product review may remain, but its states, copy, and reason taxonomy must be explicitly compliance/technical/rights/safety focused rather than merit review.
- The current schema permits one user to hold memberships in multiple Creator records without primary/additional ownership or billing state; policy does not permit this authorization relationship to multiply free benefits.

### Missing enforcement and durable state

- No creator coupon campaign or product-level non-stacking checkout mechanism exists.
- Customer legal/profile data, addresses, birthday, notification preferences, and safe saved-payment-method metadata are not yet modeled as settled here.
- Creator legal/business/contact/address fields, Agreement acceptance/versioning, rights declarations, primary-versus-additional identity ownership, additional-account billing, payment-method readiness, and six-month audit/cure state are not yet modeled.
- Paid-product publication validates marketplace capacity and files but does not yet require valid Connect payout setup and payment-method readiness together.
- Current statements expose monthly finance records, but the annual/YTD business-record package is incomplete.

### Compatible foundations to retain

- Guest checkout and secure legitimate delivery are established and must remain available.
- Registered account library, order recovery, and entitlement foundations remain compatible.
- Creator financial snapshots and the provider-independent ledger preserve historical economics and can support policy-reason snapshots.
- Connect hosted onboarding preserves the sensitive-data boundary.
- Creator listing lifecycle, inactivity, advertising, and operator publication tooling provide compatible enforcement boundaries for the new registration rules.

## 14. Recommended implementation order

1. Add the settled customer and Creator registration fields with explicit public/private projections.
2. Add versioned Creator Agreement acceptance and product-level rights/representation declarations, with no AI disclosure.
3. Model a legal seller’s free primary Creator identity and separately billed additional identities; compose additional-account and Preferred fees without multiplying free benefits.
4. Add safe Stripe payment-method readiness and enforce it for all Creator accounts; require valid Connect readiness before paid publication.
5. Implement the six-month operational audit and reasonable cure workflow separately from product inactivity.
6. Complete annual and year-to-date downloadable business records while retaining monthly statements.
7. Keep raw payment, identity, KYC, tax, and bank data in Stripe and keep production payout execution gated by its separate operational approval.

## 15. Intentionally unsettled

Do not invent exact agreement prose, cure-period length, data-retention periods, payment-method provider workflow, advertiser rate card, sponsor inventory cap, production Connect/payout execution, detailed Preferred event mechanics beyond settled benefits, or any unannounced brand expansion. AI disclosure is settled as not required and must not be reintroduced indirectly.
