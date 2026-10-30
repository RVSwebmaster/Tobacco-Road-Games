# Operation Severance — Task 2J Checkpoint

Task 2J connects paid native D1 ownership to TRG's existing signed secure-download route. An authenticated purchaser can stream the exact PDF captured in the immutable order-item snapshot from private `TRG_PRODUCTS` storage. Legacy secure downloads remain unchanged.

## Delivery model

- Migration `061_secure_native_product_delivery.sql` gives each native entitlement an opaque, unique download reference and adds download timestamps, a success count, and a native download-audit table.
- Version 2 signed download credentials contain only the opaque entitlement reference, issue/expiry times, and credential kind. They contain no order ID, order-item ID, product slug, purchaser data, or R2 key. Existing version 1 legacy credentials remain supported.
- The route requires a valid, verified customer session whose user ID matches both the entitlement purchaser and the paid native order. It also revalidates the entitlement, order, item, native product identity, Creator identity, and immutable delivery snapshot.
- Delivery uses the order item's purchased `delivery_r2_key_snapshot`, filename, and content type. The live catalog is not consulted, so later repricing, pausing, unpublishing, or delivery-key changes do not alter an existing purchase.
- Only validated publication PDF keys under `catalog-publications/` are accepted. The route streams `R2Object.body` directly and returns private/no-store, attachment, PDF, and nosniff headers without exposing internal references.
- Successful retrieval is audited and marks native fulfillment fulfilled. A missing R2 object fails closed with a generic temporary-unavailable response, records a recoverable fulfillment failure, and leaves payment and ownership intact.

## Staging evidence

- Verified staging D1 as `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`) and confirmed migration 061. Production was not accessed.
- Through the isolated staging Pages preview and native D1/R2 bindings, published a disposable fixed-price PDF product, prepared its authoritative order, attached an isolated test Session identity, and processed a correctly signed test-mode webhook through `/api/stripe/webhook`.
- The paid order created one native entitlement. Its opaque credential contained no internal order identity or R2 key.
- The authenticated purchaser retrieved the exact uploaded PDF bytes through `/store/download`; content type, attachment filename, no-store caching, and nosniff headers were verified.
- The same credential without the purchaser session was rejected. Repricing and pausing the live product did not remove access to the purchased snapshot. A second authorized retrieval succeeded and both downloads were audited.
- Cleanup removed the download audits, entitlement, webhook event, order and items, product record, cover/PDF R2 objects, and disposable Owner session. Staging store state was restored and verified `CLOSED`.

## Preserved Task 2H limitation

The isolated Pages preview still has no access to the staging project's encrypted Stripe test secret. The payment endpoint failed closed with `503`; no real Stripe-hosted Checkout Session or test-card transaction was completed. The staging proof used the existing verified webhook path with an isolated signing secret and synthetic test-mode Checkout Session identity. Production and staging-production secrets were not copied or weakened.

## Remaining integration

- My Library does not yet list native entitlements or issue native download credentials through its customer interface.
- Native delivery email, guest-purchase account claiming, free acquisition, refunds, revocation policy, and Creator accounting remain later tasks.
- A missing purchased R2 object requires operational restoration of that exact immutable key; the route does not substitute a mutable live-catalog file.

No production resource or GitHub operational integration was used.
