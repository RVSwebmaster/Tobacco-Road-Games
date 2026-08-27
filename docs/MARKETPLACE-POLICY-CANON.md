# Tobacco Road Games Marketplace Policy Canon

Status: Canonical pre–Pass 10 business policy

Implementation baseline: `ae7d1ef Add Stripe Connect sandbox payout preparation`
Audience: internal product, policy, and engineering work

This document is the authoritative source for settled Tobacco Road Games marketplace policy. Implementation notes and temporary development defaults do not override it. Items explicitly marked unsettled must not be invented during implementation.

## 1. Accounts and seller registration

TRG supports guest customers, registered customers, and registered sellers/creators.

- Guest checkout remains intentionally supported. A customer may buy by card and receive legitimate delivery without creating an account.
- Registered customers receive conveniences such as My Library, purchase history, recovery, and account-managed access. A customer account is not automatically a seller account.
- Any account holder may register as a seller after satisfying required identity, public-profile, agreement, contact, payout, legal, and technical requirements.

Seller registration is onboarding, not an application or artistic merit review. TRG does not decide whether a creator is “good enough.” Product review is separate and is limited to marketplace, technical, delivery, rights, safety, and policy compliance—not taste. Detailed registration fields remain unsettled.

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

Seller registration must eventually establish marketplace-agreement acceptance, rights and content compliance, required public profile information, private operational contact information, identity, and payout readiness. Public and private creator information must be deliberately separated. Provider-hosted onboarding remains the preferred boundary for sensitive identity and payout information.

Full creator agreement language, exact legal fields, a detailed rights/content policy, an AI-disclosure policy, public/private field definitions, and the exact timing of payout onboarding are not yet settled. Implementation must not infer or publish these terms.

## 12. Implementation gap register at baseline `ae7d1ef`

The following are compatibility findings, not authorization to implement them in this policy pass.

### Existing behavior that conflicts with canon

- `creator-finance.mjs` falls back to a flat 1,500 basis-point (15%) development fee. Canon requires sale-time selection among the one-time 10% launch fee, standard 20%, active-Preferred 10%, and any creator-favorable event policy.
- Creator tools currently require `marketplace_status='approved'` and tell a blocked user that the account is “not approved.” This can imply gatekeeping. The state should become compliance/onboarding eligibility, not artistic approval.
- Creator listing review uses broad “Approve” language. Product review may remain, but its states, copy, and reason taxonomy must be explicitly compliance/technical/rights/safety focused rather than merit review.
- Existing paid acquisition flows assume catalog prices; PWYW appears as intake metadata but does not yet provide authoritative customer-entered pricing and dual $0/paid checkout behavior.

### Missing enforcement and durable state

- No durable product identity carries an immutable first-publication timestamp or one-time launch window.
- No sale-time policy resolver snapshots launch, Preferred, or TRG event precedence and reason.
- No Preferred annual-term, billing-cadence, benefit-window, renewal, or cancellation model exists.
- No 20/22 active catalog capacity or 1/2 PWYW capacity enforcement exists, and the RV Sawyer catalog exception is not modeled.
- No public ad creative, eligibility, included slot, rotation fairness, house-ad cap, or calm banner system exists.
- No outside-sponsor inventory or Free-versus-Preferred dashboard placement exists.
- No Ad Credit purchase balance, activation, 30-day slot, or equal-weight rule exists.
- No creator coupon campaign or product-level non-stacking checkout mechanism exists.
- No rolling activity timestamp, warning, grace, automatic inactivity, notice, or capacity-releasing/reactivation model exists.
- Free download delivery exists, but marketplace creator acquisition, entitlement, analytics, and inactivity qualification need a single durable event model.
- Public/private creator field definitions, agreement acceptance, rights/content policy, AI disclosure, and detailed seller-registration data remain intentionally undefined.

### Compatible foundations to retain

- Guest checkout and secure legitimate delivery are established and must remain available.
- Registered account library, order recovery, and entitlement foundations remain compatible.
- Creator financial snapshots and the provider-independent ledger preserve historical economics and can support policy-reason snapshots.
- Connect hosted onboarding preserves the sensitive-data boundary.
- Creator listing lifecycle and operator publication tooling can be reframed around objective compliance review.
- Paused/inactive catalog behavior already has partial technical concepts, but not the settled rolling-activity policy.

## 13. Recommended Pass 10 implementation order

1. Add policy vocabulary and durable identities: distinguish seller registration eligibility from product compliance review; add immutable product identity and first-publication time.
2. Build an effective-dated sale policy resolver and snapshot the exact split, basis points, source/reason, Preferred term, launch window, promotion, and discounted basis on every order line.
3. Add Preferred annual-term state and benefits without enabling production billing until its payment workflow is separately approved.
4. Enforce active catalog and PWYW limits, including the owner catalog exception but no promotional exception.
5. Complete free/PWYW acquisition semantics and durable activity events before inactivity automation.
6. Add rolling 12-month warning/grace/inactivation state and notices while preserving entitlements and the original launch timestamp.
7. Add creator coupons and Ad Credit accounting with checkout guardrails and immutable redemption history.
8. Add public creator-ad inventory and accessible rotation fairness, then separate dashboard sponsorship inventory and Preferred suppression.
9. Add agreement, rights/content, AI disclosure, and public/private profile fields only after the intentionally unsettled policies are decided.
10. Keep production Connect and payout execution disabled until their separate operational and policy approvals.

## 14. Intentionally unsettled

Do not invent or publish policy for detailed seller-registration fields, exact seller legal-information requirements, payout-onboarding timing, full creator agreement language, rights/content terms, AI disclosure, public/private field definitions, advertiser rate card, sponsor inventory cap, reactivation workflow details, production Connect, production payout execution, detailed Preferred event mechanics beyond settled benefits, or any unannounced brand expansion.
