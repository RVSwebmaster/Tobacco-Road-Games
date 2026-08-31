# Marketplace Advertising — Pass 12

Creator ad creative, rotation entitlements, purchased slots, and Ad Credits are separate durable records. Standard creators receive one included active slot and Preferred creators receive five. A five-credit pack costs 500 integer cents; each redemption creates one interchangeable 30-day purchased slot. Credit sales are TRG service revenue and never enter creator earnings.

The five-credit package may be paid through the existing external path or explicitly with at least $5 of cleared Creator Balance. Creator Balance settlement records zero Stripe processing and no product GMV. Credits remain unused until redemption. Redeeming one credit creates one additional 30-day slot; changing the eligible validated creative or product in that slot consumes no additional credit and does not reset its clock. Expiration ends rotation capacity without automatic renewal.

The development banner specification is PNG/JPEG/WebP, 5 MB maximum, 1200×240 (5:1), required alt text, an approximately 120-second visible interval, and an 800 ms fade. Specifications are centralized in `AD_SPEC`. Creator files are magic-byte checked and privately staged before operator acceptance.

The public pool treats each occupied included or purchased slot as one equivalent rotation entry. It rotates the starting offset by minute rather than creator identity, and admits at most two explicitly weighted house/event records per response. No creator, including RV Sawyer, receives identity-based priority. Free creator dashboards use only approved outside-vendor sponsors; Preferred dashboards use only TRG Creator Notices.

An impression is conservatively recorded at most once per ad per five-minute server bucket and a click once per minute bucket. These aggregate counters do not affect entitlements and use no behavioral profile. Inactive, paused, rejected, unpublished, expired, or otherwise unavailable products are filtered at read and activation time; creative remains stored.

Operator-managed sponsor categories are intended for relevant, reputable creator services such as printing, POD/manufacturing, dice, conventions, fulfillment, publishing/layout software, editing, licensed stock art, crowdfunding, bookkeeping, shipping, and packaging. Predatory or deceptive advertising is unacceptable. Operator approval remains authoritative rather than hard-coding future business categories.

Deferred: advertiser self-service, promised impression delivery, detailed campaign analytics, image dimension decoding/enforcement, automated malware/image moderation, refunds for service-credit packs, and coupons.
