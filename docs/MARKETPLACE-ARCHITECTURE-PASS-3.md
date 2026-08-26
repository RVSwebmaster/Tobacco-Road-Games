# Marketplace Architecture — Pass 3

## Discovery metadata

All discovery fields remain optional and descriptive. Accepted enums are:

- `gmMode`: `required`, `optional`, `gm-less`
- `prepBurden`: `none`, `low`, `moderate`, `high`
- `playDuration`: `short`, `standard`, `extended`
- `playMode`: `one-shot`, `campaign`, `either`
- `rulesComplexity`: `light`, `medium`, `heavy`
- `mediaType`: `digital`, `physical`, `hybrid`

`genre` and `language` are optional strings; `contentDescriptors` is an optional string array; player minimum and maximum are optional integers from 1–100 with minimum not exceeding maximum. Owner publishing and storefront generation reject malformed supplied values. Sparse legacy products remain valid. Runtime catalog entries carry these fields, but pricing, checkout eligibility, Stripe, fulfillment, entitlements, delivery, and store-state code do not read them.

The existing browser filter can absorb exact-match controls for GM mode, prep burden, play mode, complexity, media type, and language. Player counts and session duration require range/semantic matching, so the next discovery pass should introduce a small query predicate layer rather than continuing to expand DOM-only exact-match checks. That layer can answer “horror for four players,” GM-less, low-prep, one-shot, rules-light, and short-session queries and later provide deterministic inputs to Gary.

## Account ownership and My Library

Migration `016_order_account_ownership.sql` adds nullable `orders.user_id` and an index for paid-library reads. Checkout records the current valid account ID when a session exists. Guest and historical orders retain `NULL`; payment and fulfillment do not depend on ownership.

`GET /api/account/library` requires the existing TRG session. Its query always predicates on the authenticated `user_id` and paid status, joins only existing order items and active entitlements, and returns public catalog snapshots plus short-lived download URLs produced by the existing entitlement credential signer. It never returns customer email, database IDs, Stripe identifiers, R2 keys, prices, or another user's records.

Historical purchases are not guessed or silently matched. A future claim flow should require a signed-in, verified email plus an existing order-access credential or recovery token and the public order reference. The server should compare the verified account email to the protected order email, write `user_id` only after all evidence succeeds, reject already-owned orders, and add an audit record. Existing order-access credentials and recovery pages provide the strongest current proof without inventing new entitlement semantics.

## Creator URL migration assessment

Product records, structured data, generator names, discussion APIs, discussion DOM attributes, tests, sitemap entries, and inbound links still use author slugs and `/authors/`. Discussions use the slug as an identifier rather than deriving it from the page URL, which makes migration feasible if the slug remains stable.

The clean path is to generate full canonical pages at `/creators/<slug>/`, update product/profile links and structured data in one generator release, add permanent redirects from `/authors/<slug>/`, keep `authors` and `authorSlugs` as data compatibility fields, update the root sitemap, and retain discussion `author_slug` storage until a later data migration. Search engines should see one canonical URL and permanent redirects, never two independently canonical profiles.
