# Marketplace Architecture — Pass 4

## Historical purchase recovery

`POST /api/account/claim-order` accepts an existing signed order-access credential only from an authenticated, same-origin, CSRF-validated session. The account email must already be verified and must exactly match the historical order's normalized email. The order must be paid and have no owner. The conditional ownership update never changes payment, Stripe, fulfillment, delivery, or entitlement records; existing entitlements make the item appear through the original My Library query.

Successful claims and useful rejections after a credential identifies an order are stored in `historical_order_claim_audit`. Each row records the account, order, time, outcome, reason code, and `verified_email_and_order_access` method. Credentials, token hashes, email addresses, and other secrets are not logged. Invalid credentials receive the same generic response and cannot be tied safely to an order audit row.

## Discovery layer

`shared/marketplace-discovery.js` is a presentation-independent predicate/query module usable by the browser today and by catalog, homepage, Gary, or server-side recommendation code later. Filters combine with AND semantics. Player counts use inclusive minimum/maximum bounds; `either` satisfies either one-shot or campaign queries, and `hybrid` satisfies digital or physical queries. Products with missing optional metadata remain valid but do not match a criterion they cannot substantiate. Results retain source order, with no creator-specific ranking.

The public catalog exposes genre, player count, GM mode, prep burden, play mode, rules complexity, and media type alongside all existing filters. Generated product pages add only populated metadata to the existing compact details list.

## Conservative backfill

The small backfill is limited to facts directly established by existing records: Sirrocans, Ringbound, and Janni are tagged `genre: fantasy` because their descriptions explicitly describe fantasy/5E player material; those three and Agency are tagged `mediaType: digital` because their listed delivered format is PDF. Player counts, GM mode, prep burden, play duration/mode, and rules complexity remain unset because the current copy does not establish them confidently. Other incomplete products remain sparse to exercise mixed completeness.

## Creator URLs

Pass 4 adds no new dependency on creator URL shape. `/authors/` remains canonical, `/creators/` remains a compatibility alias, and the Pass 3 migration inventory still applies: change canonicals, internal links, schemas, sitemap entries, discussion/profile link consumers, and permanent redirects together in a later isolated release while retaining stable creator slugs.
