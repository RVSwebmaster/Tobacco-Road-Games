# Marketplace Discovery Labels

Discovery labels are temporary, explainable navigation signals. They are not badges, awards, advertising, membership benefits, a universal Creator score, or a leaderboard. Calculations never read Preferred terms, Founding/achievement badges, ads, or the RV Sawyer owner override.

## Configurable staging defaults

- New Release: 30 days after immutable first publication
- Recent paid-sales window: rolling 30 days
- New & Rising: first 90 product days / 180 Creator days
- Recalculation and expiration: 24 hours
- Minimum verified Creator ratings: existing public threshold, default 5
- Minimum paid sales: 3; unique acquisitions: 3; early engagement: 2

The owner should confirm the 30-day public New Release duration. It is independent of the separate launch revenue split.

## Definitions

| Label | Applies to | Rule |
|---|---|---|
| New Release | Product | Active published product within 30 days of durable `first_published_at`; edits, relisting, repricing, pause/reactivation, and inactivity return do not restart it. |
| Top Rated | Creator | Rating threshold plus confidence-adjusted score ≥4.2, using visible/fraud-clear ratings. The observed average is blended with a neutral 4.0 prior weighted as 10 ratings, preventing five perfect ratings from indefinitely outranking hundreds of strong ratings. Product Top Rated is deferred because no product-rating model exists. |
| Customer Favorite | Product, Creator | Product: 3 unique acquisitions and ≤10% reversal rate. Creator: rating threshold, 3 unique acquisitions, and the same problem-rate guardrail. |
| Best-Selling | Product, Creator | At least 3 legitimate paid orders in the rolling 30-day window and the eligible 75th percentile. |
| Most Downloaded | Product | At least 3 unique legitimate acquiring customers and the eligible 75th percentile. Active entitlements include paid, free, and PWYW-at-$0 acquisition; repeat downloads do not count. |
| New & Rising | Product, Creator | Within the 90/180-day window with at least 2 recent acquisition-plus-sale signals; established entities age out. |

Percentile ties qualify together. Consumers may fairly rotate similarly qualified results; the service publishes no hidden total order.

## Exclusions and anti-gaming

Discovery filtering never changes accounting. Creator self-purchases remain legitimate transactions but receive zero organic Best-Selling weight. Active fraud blocks, non-customer roles, test activity, refunded/disputed orders, and recorded reversals are excluded. Unique account-or-email acquisition keys suppress retry/re-download noise. Operator-only exclusion counts are signals, not accusations or automatic enforcement.

## Lifecycle and operations

Records store subject, current state, public reason, operator-only metrics, source window, calculation/expiry times, and version. Recalculation is batch-safe and idempotent by `run_key`; production scheduling is not enabled.

Public `/api/discovery-labels` returns only title, plain-language reason, update time, and expiry. Operator controls expose metrics and runs, allow manual recalculation, and allow removal only for calculation error, fraud/manipulation, test contamination, or policy violation. Removal is audited and suppresses recalculated restoration until explicitly cleared. No manual boost control exists.

Current product cards/pages and Creator profile/directory hooks show at most two or three readable labels without changing ordering.

Deferred: production scheduling, homepage rails, rotation-result APIs, product Top Rated, related-account/device clustering, and full redesign. No Creator Agreement conflict was found.
