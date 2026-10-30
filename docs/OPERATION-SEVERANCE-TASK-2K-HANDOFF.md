# Operation Severance — Task 2K Checkpoint

Task 2K integrates paid native D1 ownership into the existing authenticated My Library experience. Native and legacy purchases share the established library API and card layout while retaining separate authorization and immutable ownership records.

## Library integration

- `/api/account/library` now combines legacy purchase entitlements with active native entitlements owned by the verified session user. Browser-supplied email, product slug, and order identifiers do not grant ownership.
- Native library history uses the entitlement and order-item snapshots for product identity, purchased title, Creator identity, version, selected price, currency, and acquisition date. Live catalog title, price, status, or visibility changes cannot rewrite the purchase record.
- Native entries receive version 2 signed download credentials containing only the opaque entitlement reference and credential timing. No private R2 key, internal order ID, order-item ID, or purchaser record is returned.
- Native entries take precedence over conflicting legacy slugs, while distinct legacy purchases and their existing credentials remain available. Repeated reads are side-effect free and do not create duplicate entries.
- Library cards now render the cover, Creator attribution, public order reference, purchase date, paid amount, payment description, purchased version, and download action using the existing Bright/Dark product-card styling.

## Authenticated covers and delivery

- `/api/account/library-cover` verifies the signed native credential and the authenticated, email-verified purchaser session before resolving the current private WebP cover from `TRG_PRODUCTS`.
- Paused and retired products remain in My Library. The authenticated cover path does not depend on public storefront visibility.
- Missing cover or delivery objects fail without deleting or hiding the ownership record. Native PDF downloads continue through the Task 2J route and its immutable order-item delivery snapshot.
- The existing Pages adapter for `/api/account/library` was corrected to pass `context.request` and `context.env` to the library handler; the prior direct re-export returned 405 in a real Pages deployment.

## Staging evidence

- Verified staging D1 as `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`) through isolated Pages deployment `271e3bdf` on the `task2k-native-library` preview branch.
- Created two disposable verified customer identities and isolated sessions. Published one disposable native PDF product, prepared its authoritative order for the buyer, and processed a correctly signed test-mode webhook through the existing verified path.
- Loaded the existing `account.html` My Library interface and `/api/account/library`. The buyer saw exactly one native entry with the purchased title, Creator, 625-cent price, version 2.5, authenticated cover URL, and secure download action.
- Retrieved the exact uploaded WebP and PDF bytes. The second verified identity could neither see the entry nor use its cover or download URL.
- Pausing, repricing, and retitling the live catalog record did not alter the library purchase snapshot or prevent the buyer's PDF retrieval.
- Cleanup removed download audits, entitlement, webhook event, order/items, product, exact cover/PDF R2 objects, both disposable customer identities, and all disposable sessions. Staging was restored and verified `CLOSED`.

## Preserved Task 2H limitation

The isolated Pages preview still has no access to the staging project's encrypted Stripe test secret. The payment endpoint failed closed with `503`; no real Stripe-hosted Checkout Session or test-card transaction was completed. The proof used the existing verified webhook path with an isolated signing secret and synthetic test-mode Checkout Session identity.

## Remaining integration

- Native free acquisition and guest-purchase account claiming remain out of scope.
- Native delivery email, refunds, revocation policy, and Creator accounting remain later tasks.
- Customer-facing refund and download-recovery policy for a permanently missing purchased R2 object still requires operational design.

No production resource, branch merge, or GitHub operational integration was used.
