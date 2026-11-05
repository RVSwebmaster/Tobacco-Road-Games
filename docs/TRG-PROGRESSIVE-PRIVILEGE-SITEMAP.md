# TRG progressive privilege site map

Issue #7 defines one recognizable public site whose authenticated capabilities accumulate. The implementation uses current account evidence instead of inventing a parallel role system.

## Inheritance and evidence

| Capability layer | Existing evidence | Homepage additions |
| --- | --- | --- |
| Guest | No valid account session | Public discovery, Creator directory, support, login, cart |
| Customer | Valid native account session | My Account and My Library |
| Creator | Customer plus an actual `creator_memberships` row | Creator Studio |
| Admin | Customer whose `users.role` is `admin` | Forum Moderation |
| Owner | Customer whose `users.role` is `owner` | Forum Moderation and Owner Office |

Public links are retained at every layer. Owner and Admin accounts receive Creator Studio only when they also have a real Creator membership, because the existing Creator APIs authorize membership rather than rank. This is the safe interpretation of cumulative privilege under the current schema: administrative status does not fabricate Creator ownership.

## Shared homepage state

The server-rendered homepage remains the fail-closed Guest shell. `/api/navigation` authenticates the existing account session and returns the additive navigation projection from `functions/_lib/public-navigation.mjs`. The browser replaces only the navigation entries; it does not redirect to a role-specific homepage.

For authenticated accounts, the same homepage reads `/api/account/library`. Owned titles are projected into the existing Your Library shelf without changing entitlement or download authorization. A library title uses the API's already-authorized download URL when one is available and otherwise links to My Library on the account page. Anonymous or failed requests retain decorative books and expose no private data.

## Existing destinations

- Customer account and My Library: `/account.html`, `/account.html#library-panel`
- Creator Studio, products, intake, pricing, profile, analytics and finance: `/creator/`
- Admin forum moderation: `/forum/moderation`
- Owner Office and its established operational links: `/owner/`

The Creator system currently combines dashboard, listings, intake, pricing, profile, analytics, finance, resources, and closure controls on `/creator/`; this change does not invent redundant pages for those controls.

## Authorization boundary

Navigation visibility is convenience only. Customer session validation, Creator membership/eligibility checks, Admin moderation roles, Owner/Administrator application checks, and Cloudflare Access protections remain authoritative on direct requests.

## Known model gap

The schema has `user`, `admin`, and `owner` account roles; Creator is a membership relationship, not a role. Therefore an Admin is not automatically a Creator. Making every future Admin a Creator would require an explicit Creator identity/membership policy and data change, which is outside this navigation task.
