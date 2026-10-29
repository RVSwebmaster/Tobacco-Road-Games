# Operation Severance — Task 2I Checkpoint

Task 2I grants durable ownership after a verified Stripe webhook authoritatively marks a native D1 order paid. It does not activate native downloads, delivery email, customer-library rendering, refunds, or Creator accounting.

## Ownership model

- Migration `060_native_paid_purchase_entitlements.sql` adds `native_product_entitlements` and recoverable entitlement state to native orders.
- Each row is uniquely tied to its immutable native order item. It snapshots purchaser association, stable product ID and slug, Creator ID, catalog revision, purchased version, pricing model, selected price, currency, and acquisition time.
- Ownership records deliberately contain no R2 object key, delivery filename, or delivery content type. The existing `download_entitlements` table remains the delivery-capable legacy mechanism and is not populated for native purchases in this task.
- Native ownership participates in duplicate-purchase detection while preserving the fallback used by schemas predating migration 060.

## Webhook and recovery behavior

- Native ownership is attempted only after verified webhook reconciliation has marked the order and native order state paid.
- `INSERT OR IGNORE`, unique order-item constraints, and reconciliation make duplicate events and explicit retries idempotent.
- A failed ownership transaction leaves payment intact, records `native_entitlement_status='failed'`, and returns a retryable webhook failure. Re-delivery of the already-processed Stripe event retries ownership without creating another order or charge.
- Successful reconciliation records `native_entitlement_status='ready'`. Product repricing, pausing, unpublishing, or later catalog edits do not alter the purchase snapshot or entitlement.
- Legacy download entitlements, fulfillment, customer history, and webhook processing remain unchanged.

## Staging evidence

- Applied and recorded migration 060 only on `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`). Unrelated migration `052_open_store_state.sql` remains pending.
- The isolated Pages preview published a disposable native product, prepared its authoritative 500-cent order, attached an isolated test Session identity, and processed a correctly signed test-mode event through `/api/stripe/webhook`.
- The order became paid and received exactly one native ownership entitlement with the correct purchaser, product, Creator, revision, version, and purchase price. No `download_entitlements` row was created.
- Replaying the same event retained exactly one entitlement. Repricing and pausing the product left the entitlement and purchase snapshot unchanged.
- Cleanup removed the entitlement, webhook event, order, product, R2 cover/PDF objects, and disposable Owner session. Staging store state was restored and verified `CLOSED`.

## Preserved Task 2H limitation

The isolated Pages preview still has no access to the staging project's encrypted Stripe test secret. The payment endpoint failed closed with `503`; no real Stripe-hosted Checkout Session or test card transaction was completed. The staging proof used the existing verified webhook path with an isolated signing secret and synthetic test-mode Checkout Session identity. Production/staging-production secrets were not copied or weakened.

## Remaining integration

- Native R2 download authorization and fulfillment remain disconnected from ownership.
- My Library does not yet render `native_product_entitlements`.
- Native delivery email, free acquisition, refunds, revocation policy, and Creator accounting remain later tasks.

No production resource or GitHub operational integration was used.
