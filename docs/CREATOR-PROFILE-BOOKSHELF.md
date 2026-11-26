# Creator Profile bookshelf and catalog desk

## Status

The Creator, Founding-25, and Premium Creator bookshelf functionality is provisionally accepted. The Owner rejected the current visual presentation as overbuilt and unattractive. Its visual design requires replacement and has not received Owner approval. Do not treat the current appearance as approved for production.

## Implementation

- Creator, Founding-25, and Premium Creator Profiles place the Creator bookshelf and private Catalog Desktop below the existing Creator plateboard and outside advertiser carousel.
- Catalog cards come from the existing D1 marketplace product records. They show each product's title, cover when available, publication/availability state, and a **Shelved** checkbox.
- Shelf assignments are stored separately from product publication and listing state. The public display resolves the selected IDs through the existing approved public product catalog, and returns only publicly listed, currently available products for active, approved Creator identities.
- Unavailable products remain manageable in the Creator's private catalog. Their shelf assignment does not make them publicly purchasable.
- Shelf changes save immediately. The interface restores the prior selection and displays an error if a save fails. Counters and server-side capacity checks use the existing `getCreatorCapacity()` policy.
- Reads and writes use the existing account session, Creator identity selection, D1 binding, and Creator ownership records. The server validates active ownership, product ownership, and shelf capacity; writes require the existing CSRF protection.
- Public Creator author pages reuse the public shelf component and stylesheet. They do not include private cards, checkboxes, or allowance counters.

## Storage and routes

Migration `080_creator_profile_shelf_selections.sql` adds `creator_profile_shelf_selections`, keyed by Creator and product, with a stable position and timestamps. It adds ownership-consistency and capacity guards without copying catalog records or changing marketplace listing state.

- `GET` and `POST /api/creator/profile-shelf` provide the authenticated Creator's private catalog and saved shelf selections.
- `GET /api/public/creator-shelf?creatorSlug=...` returns eligible public shelf products only.

## Verification

Run `npm run test:creator-profile-shelf` for persistence, ownership, public eligibility, capacity enforcement, and tier allowances. `npm run test:member-profiles` checks layout placement and that unrelated membership Profiles remain unchanged. `npm run test:pages-build` checks the Pages artifact allowlist. The storefront visual baselines are checked with `npm run test:storefront-visual`.

The local preview screenshots used clearly labeled sample catalog data because this checkout has no local Creator catalog records.
