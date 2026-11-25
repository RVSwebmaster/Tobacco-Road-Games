# Creator Plateboard Advertising Policy

**Owner-approved policy**

Every Creator receives two free advertising appearances per UTC day in the Guest Storefront plateboard. Each Creator's two scheduled appearances are separate and are distributed approximately twelve hours apart when the roster permits.

The plateboard uses a configurable entry interval. The default interval is 60 seconds. Each scheduled advertisement travels smoothly from left to right through the three plateboard positions and then exits. At 60 seconds per entry, a full day has 1,440 scheduled appearances, enough for 720 Creators at two appearances each. Shortening the configured interval increases capacity; if the roster is smaller than capacity, unused schedule slots remain empty instead of repeating a Creator beyond the two-appearance policy.

An appearance is a scheduled place in the plateboard rotation. It is not a promise that a particular person viewed or interacted with the ad. TRG does not promise impressions, clicks, sales, conversions, or particular viewing times.

This policy applies only to the Guest Storefront plateboard. It is a free, equal schedule for Creators and does not add paid tiers, paid privileges, Ad Credits, or extra Creator advertising entitlements. It does not change the separate lower external advertising carousel, its marketplace pools, or the Customer Storefront.

Plateboard eligibility requires an approved, eligible Creator account and an accepted advertising creative. An active or published product listing is not required. Advertising creative may promote any lawful subject and does not need to promote a Tobacco Road Games product, an RPG, or the Creator's own business. If an active, published product destination is available, the existing product link may be retained; otherwise the ad still appears without a product destination. The schedule itself does not record impressions or clicks. A Creator without an accepted creative has nothing to schedule until one is accepted.

## Implementation settings

- Cloudflare Pages variable `CREATOR_PLATEBOARD_ENTRY_INTERVAL_SECONDS` configures the normal spacing between scheduled entries; absent or invalid values use 60 seconds. If the eligible roster exceeds that interval's daily capacity, the schedule automatically shortens the interval enough to preserve two appearances per Creator.
- The public feed returns accepted creative from approved Creators and interval configuration to the Guest Storefront only. Listing publication, inactivity, review hold, and product slug do not affect plateboard eligibility.
- The Guest page computes a deterministic UTC-day schedule, places each Creator twice in separate half-day windows, and animates scheduled appearances across the three positions.
- When the interval is 60 seconds and 720 Creators have eligible creative, the schedule is one entry per minute. At lower enrollment, remaining slots stay empty; Creators are not repeated to fill them. Above 720 eligible Creators, the interval shortens as needed instead of dropping appearances.
- Local motion preview mode uses the existing fictional sample ads and an accelerated five-second interval. It is visual demonstration only and is not the production schedule.
