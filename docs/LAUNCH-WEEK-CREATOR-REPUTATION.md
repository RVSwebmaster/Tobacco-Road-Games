# Launch Week and Creator Reputation

This staging-safe pass adds D1 infrastructure without opening the store or changing transaction, payout, registration, refund, or Creator Agreement policy.

## Launch Week

`marketplace_events` holds `official-launch-week`. Its lifecycle is `prelaunch`, `live`, or `archive`; public visibility is separate. Event and founding-window timestamps are nullable ISO values and intentionally ship unset. `content_json` provides state copy and optional daily slots. `/launch-week/` is unindexed and `/owner/creator-reputation.html` is the operator preview.

Do not make the event public until dates and copy are approved. D1 enforces ordered event and founding windows.

## Founding Creator and badges

Founding Creator is historical recognition, not a tier or ranking input. Preview uses completed registration within the inclusive founding window. Suspended/deleted identities, inactive owners, admin/system accounts, and test/staging/smoke handles are excluded. RV Sawyer follows the same rules. Awarding is explicit and audited; it persists after the event ends. Revocation/correction fields exist only for mistake or abuse.

Badge definitions and awards are separate. Categories are `historical`, `achievement`, `service_tier`, and `reputation_status`; they never collapse into rank. Awards preserve source, notes, issuer metadata, date, optional expiration, and state. Icon keys can use existing private R2 patterns. No achievement is seeded. Preferred Creator is only a service-tier definition here; entitlement remains in the paid membership system. Badges create no fee, ad, catalog, or ranking benefit.

## Verified Creator ratings

Creator ratings are distinct from product ratings. A signed-in customer can rate only after a paid order from that Creator with an active digital entitlement or physical/hybrid listing. Unique `(creator_id,user_id)` permits one active score per relationship; updates retain history. Structured categories are representation accuracy, file completeness, correction reliability, and transaction experience. There are no ideology, identity, politics, production-method, or AI categories.

Public aggregation includes visible, fraud-clear ratings. `CREATOR_RATING_PUBLIC_THRESHOLD` controls display; default is 5. Below it the API returns `New Creator` or `Too few ratings`, never zero stars. Private Creator analytics add actual average/count, distribution, and simple recent trend without customer identities.

Operators can hide suspected fraud, flag brigading or abuse, and restore false positives. Every change retains history and an objective reason. Public written reviews are not implemented.

### Customer UI and entry points

Eligible, signed-in, email-verified customers receive “Rate your experience with this Creator” controls in My Library and on the relevant Creator profile. My Library groups the control to one instance per Creator even when several products from that Creator are owned. Eligibility and submission use the same server-side acquisition check; the browser receives only an eligibility boolean and the customer’s own current score/timestamps, never entitlement or moderation internals.

The form is a single 1–5 star fieldset. Submitting creates the relationship score; submitting again updates that score while appending audit history. A customer update cannot undo an operator moderation state. No written feedback field or public review/comment surface is exposed.

Public Creator profiles show the configured neutral or aggregate state, up to three prominent badges, accessible badge descriptions, and a decorative Founding halo only when the durable badge exists. Product attribution and directory cards use a compact maximum of two badges plus the public reputation state and link back to the full profile. Directory order is unchanged and is not based on stars.

Creator-private analytics show average, verified-rating count, trend, and the five-star distribution. They contain no customer IDs, emails, order references, or transaction details.

## Discovery, accessibility, and deferred work

`creator_reputation_labels` provides non-ranking hooks for Top Rated, Customer Favorite, New & Rising, Best-Selling, and Most Downloaded. No leaderboard or scoring algorithm exists.

Badges have text and accessible labels; ratings have text equivalents. Each star radio is keyboard operable, has a value-specific screen-reader label, and has a visible focus state. Selection is conveyed by control state as well as appearance. The Founding halo is a decorative CSS pseudo-element and never enters the accessibility tree. Reduced-motion rules disable effects.

Deferred: production dates, campaign activation, participants, achievement assets/awards, public written reviews/comments, automatic discovery calculation, and full redesign. No Creator Agreement conflict was found.
