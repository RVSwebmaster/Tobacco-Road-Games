# Operation Severance — Task 2G Checkpoint

Task 2G adds an additive native-order foundation without activating payment, free acquisition, entitlements, or fulfillment.

## Durable model

- `058_native_d1_order_foundation.sql` marks native orders, records a native lifecycle state (`pending`, `paid`, `free_acquired`, `canceled`, or `failed`), and adds immutable native item snapshots.
- Each native item freezes product and Creator IDs, catalog revision, title, authors, version, pricing model, list and selected prices, PWYW bounds, currency, publication/status values, and the private R2 delivery key, filename, and content type.
- A database trigger prevents later updates to native order item snapshots. Existing legacy rows receive `catalog_source='legacy'` and otherwise retain their prior behavior.

## Preparation boundary

- `POST /api/cart/prepare-order` re-resolves every requested slug through the Task 2F hybrid catalog, validates publication and Creator eligibility, calculates authoritative fixed/free/PWYW pricing, verifies identity/fraud/duplicate-ownership policy, and atomically records a native pending order.
- Checkout-attempt IDs remain unique. Identical retries return the existing order; reuse with changed price, selected PWYW amount, catalog revision, product metadata, or private fulfillment reference returns a conflict and does not mutate the first snapshot.
- Legacy-only requests remain on the existing checkout path. Mixed native/legacy preparation is rejected without creating a partial order.
- Responses expose a public order reference and safe price summaries only. D1 IDs, customer hashes, and private R2 delivery fields are not returned.
- Native orders retain `payment_status='pending'`, `fulfillment_status='pending'`, `payment_source='none'`, and `settlement_method='no_payment'`. The preparation endpoint never calls Stripe or R2, marks a free acquisition paid, creates an entitlement, or starts fulfillment.

## Staging proof

- Applied only `058_native_d1_order_foundation.sql` to `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`). The older unrelated `052_open_store_state.sql` remains unapplied in the migration ledger.
- Published a disposable PWYW product through the native staging publication endpoint and prepared it through an isolated Pages preview using native D1 bindings.
- Verified selected price, product/Creator identity, catalog revision, private delivery snapshot, exact retry reuse, repricing conflict, new-revision preparation, and paused-product rejection.
- Staging currently has no generated legacy runtime product, so its mixed-cart probe rejected the legacy slug as unknown before order creation. The deterministic test suite covers a real injected legacy/native mixed catalog and verifies the dedicated mixed-cart rejection.
- Removed both disposable orders, their item snapshots, the product, R2 objects, and the temporary Owner session. Restored staging store state to `CLOSED`. A final query confirmed zero `task2g-*` products, native items, and sessions.

## Remaining integration

- The public cart does not call order preparation yet.
- Native Stripe Session creation, free acquisition, order-state transitions, entitlements, secure D1/R2 fulfillment, customer-library ownership, refunds, and Creator accounting remain disabled.
- A later task must activate those operations from the immutable snapshot rather than re-reading mutable catalog values.

No production resource or GitHub operational integration was used.
