# Operation Severance — Task 2L Checkpoint

Task 2L enables authenticated customers to acquire native D1 fixed-free products and PWYW products with a zero-dollar minimum. The completed acquisition creates an immutable native order snapshot and durable entitlement without contacting Stripe, then appears through the existing My Library and secure private-R2 delivery paths.

## Acquisition path

- `POST /api/cart/acquire-free` requires an active, email-verified customer session and a same-origin request. A browser-supplied email, product slug, order reference, or price is never sufficient to establish identity or ownership.
- The endpoint uses the Task 2F authoritative D1 quote path and Task 2G order preparation path. It accepts native-only zero-value carts, revalidates the live product ID, slug, Creator, revision, publication/availability state, pricing rules, immutable delivery snapshot, and private PDF object before completion.
- Fixed-free products and PWYW products whose minimum is zero are supported. Paid native products, PWYW values below a positive minimum, legacy/native mixed carts, unpublished or unavailable products, ineligible Creators, forged prices, guests, and unverified accounts fail closed.
- Successful acquisition stores `payment_status=paid` for compatibility with the established ownership model while explicitly distinguishing the transaction as `native_order_state=free_acquired`, `payment_source=none`, and `settlement_method=no_payment`. Stripe Checkout Session and PaymentIntent fields remain null.
- The entitlement source is `native_free`. Database uniqueness and order/item constraints make retries and concurrent processing idempotent. A failed atomic entitlement batch leaves the pending order retryable with the same acquisition attempt and never initiates payment.
- Browser responses contain public order references and public product details only. Private R2 keys, internal order/item identifiers, and purchaser records are not exposed.

## Schema

Migration `062_native_free_product_acquisition.sql` extends native entitlement snapshots to include zero selected prices and `native_free` ownership while preserving all paid-entitlement and download-audit history. Its insert trigger permits only either an authoritative Stripe-paid order or an authoritative no-payment `free_acquired` order. Free active ownership is unique per verified customer and native product; existing paid ownership behavior remains compatible.

My Library and secure delivery now recognize both `paid` and `free_acquired` native order states. Ownership continues to be authorized from the durable entitlement and immutable order-item delivery snapshot, independent of later storefront visibility.

## Staging evidence

- Verified D1 staging as `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`) and applied only migration 062. The migration ledger records `062_native_free_product_acquisition.sql` as entry 62.
- Built and deployed isolated Pages preview `2fa015bb` on alias `task2l-native-free.tobacco-road-games-staging.pages.dev`, bound only to staging D1 and `trg-products-staging`.
- Published one disposable fixed-free product and one disposable PWYW product with minimum zero through the native Owner publication endpoint. Both records and their WebP/PDF objects were verified through native bindings.
- Acquired both through authenticated customer requests. D1 recorded zero totals, `payment_source=none`, `settlement_method=no_payment`, null Stripe identifiers, and one `native_free` entitlement per product. Repeating each request returned the existing acquisition and created no duplicate order or entitlement.
- Both products appeared immediately in My Library and returned the exact uploaded PDFs through signed secure delivery. A second verified customer could neither see nor retrieve either purchase.
- Cleanup removed download audits, entitlements, orders/items, products, both exact cover/PDF object pairs, disposable sessions, and disposable customer identities. Final queries reported zero Task 2L products, orders, users, or sessions, and staging was restored and verified `CLOSED`.

## Verification

- Targeted native free-acquisition tests cover normal free acquisition, fixed-free compatibility, zero-dollar PWYW, positive-minimum rejection, forged prices, unavailable products, ineligible Creators, guest/unverified/cross-origin rejection, duplicate and concurrent requests, atomic entitlement failure and recovery, library visibility, secure delivery, second-customer denial, no Stripe state, and legacy free-route compatibility.
- Paid native Stripe, entitlement, delivery, library, storefront cart, and legacy free-download regressions pass.
- Full `npm test`, `npm run test:storefront-visual`, `npm run build:pages`, and Pages Functions compilation pass. The live preview deployment also compiled its Worker successfully.

## Preserved Task 2H limitation and remaining work

No real Stripe-hosted Checkout Session or test-card transaction was completed. The outstanding Task 2H live Stripe test-mode limitation remains unchanged.

Guest claiming, native delivery email, refunds/revocations, and Creator accounting remain outside Task 2L. Owner Intake and Creator publishing remain disconnected from the native publication path. No production resource, branch merge, or GitHub operational integration was used.
