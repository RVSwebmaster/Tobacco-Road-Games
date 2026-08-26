# Marketplace Architecture — Pass 2

## Identity boundaries

- **Marketplace operator / seller:** Tobacco Road Games operates discovery, checkout, customer accounts, community, and store controls.
- **Creator:** the person or entity responsible for authored game content. Public rendering uses “Creator.”
- **Publisher / imprint:** the publishing identity recorded by a product's optional `publisher` field.
- **Brand:** an optional product brand, especially for future TRG physical merchandise. No brand is inferred when the field is absent.
- **Product / listing:** the sellable catalog record.

`authors`, `authorSlugs`, `data/authors.js`, `/authors.html`, and `/authors/<slug>/` are compatibility contracts. They remain in place so catalog filtering, structured data, discussions, tests, and existing inbound links continue working. The storefront generator normalizes those records into creator objects for public rendering. `/creators/` and `/creators/<slug>/` are safe aliases that point visitors to the established canonical pages.

## Creator record contract

Creator records tolerate missing optional fields. Supported fields are `displayName`, `slug`, `profileImage`, `logo`, `bannerImage`, `title`, `shortBio`, `longBio`, `profileTemplate`, `accent`, `links`, `marketplaceStatus`, `joinDate`, and `blogPosts`.

Supported templates are `bookshelf` and `catalog`. Unknown or missing templates fall back to `catalog`; RV Sawyer explicitly selects `bookshelf`. Adding `studio` or `minimal` later only requires a renderer branch and adding the template key to the allowed set.

Only creators with `marketplaceStatus: "active"` appear in the directory. Ordering is alphabetical, independent of product count, ownership, or featured-product state.

## Product metadata audit

All proposed discovery fields can be added to `data/products.json` as optional values without changing commerce behavior because checkout pricing and fulfillment normalize only their existing allowlisted fields. Recommended shapes:

- `genres: string[]`
- `playerCountMin: number | null`, `playerCountMax: number | null`
- `gmMode: "required" | "gmless" | "optional" | "unknown"`
- `prepBurden: "none" | "low" | "medium" | "high" | "unknown"`
- `playDurationMinutesMin: number | null`, `playDurationMinutesMax: number | null`
- `playScope: "campaign" | "one-shot" | "either" | "unknown"`
- `rulesComplexity: "light" | "medium" | "heavy" | "unknown"`
- `mediaType: "digital" | "physical" | "both"`
- `languages: string[]`
- `contentDescriptors: string[]`

The work is low-risk at the data and normalization layer, moderate at the generator/filter UI layer, and higher only when validation, intake tooling, and Gary ranking semantics are added. Pass 3 should add validation and owner-intake support before exposing filters, so sparse legacy records remain valid.

## My Library assessment

The account and entitlement systems contain most required primitives, but they are not joined. Accounts have stable `users.id`; paid orders are keyed by normalized email and a secret-derived email hash; order items snapshot product/version data; `download_entitlements` records active files and download history; order-access credentials already produce secure download pages and signed download credentials.

The smallest safe path is:

1. Add an explicit, nullable account ownership relation for orders (prefer `orders.user_id` with an index and foreign key where migration constraints allow).
2. Attach the signed-in user during checkout, while preserving guest checkout.
3. Provide a carefully scoped authenticated read endpoint that lists only that user's paid orders, items, active entitlements, receipts, and current product update metadata.
4. Reuse the existing download-credential generator rather than exposing R2 keys or permanent URLs.
5. Add a verified-email claim flow for historical orders, with audit records and collision-safe handling, instead of silently matching accounts to all orders by email.
6. Render the result inside the existing account page as My Library.

No account or entitlement behavior was changed in Pass 2.

## Deferred debt

- Canonical URLs still use `/authors/`; aliases prepare but do not force migration.
- Internal function and CSS names still use `author` where renaming would add risk without public benefit.
- The static generator and server-rendered Functions share the same navigation destinations and wording, but their definitions live in runtime-appropriate modules until the build system is unified.
- Publisher and brand are optional product fields; no broad schema or intake migration has been performed.
- Creator permissions, dashboards, payouts, ranking, Gary, Friday, and physical fulfillment remain out of scope.
