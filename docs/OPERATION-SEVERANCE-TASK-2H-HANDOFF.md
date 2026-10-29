# Operation Severance — Task 2H Checkpoint

Task 2H connects paid native D1 order snapshots to the existing Stripe Checkout and verified webhook infrastructure in test mode. It does not enable free acquisition, entitlement creation, fulfillment, customer-library ownership, refunds, or Creator accounting.

## Payment initiation

- `POST /api/cart/pay-order` accepts the Task 2G checkout attempt, public order reference, and verified customer identity. Browser prices and cart contents are ignored.
- Stripe line items are built only from immutable `order_items` snapshots. Fixed and positive PWYW prices are supported; free and mixed orders are rejected.
- The endpoint requires `PAYMENT_PIPELINE_STAGE` to be non-production and `STRIPE_SECRET_KEY` to be a test key. Production/live keys are rejected.
- The pending order must still be within its stored payment window, remain pending, and have no terminal or paid state. Every snapshotted product is rechecked for stable identity, Creator eligibility, publication, catalog revision, pricing mode, and unchanged private delivery mapping before the first Session is created.
- Stripe Session creation uses the checkout attempt as its idempotency key. Repeated requests reuse the attached Session and cannot create a second order or unintended charge.
- Session and PaymentIntent metadata carry internal/public order identity, checkout attempt, and `trg_order_source=native_d1`.

## Verified webhook settlement

- Existing signature, timestamp, API-version, livemode, Session, amount, currency, order, attempt, and PaymentIntent checks remain authoritative.
- Native events additionally require the `native_d1` order-source metadata.
- A matching paid event sets `payment_status='paid'` and `native_order_state='paid'` atomically. Expiration and asynchronous failure map to canceled/failed native states only while still pending.
- Native paid events explicitly skip Creator sale snapshots, earnings, inactivity activity, R2 fulfillment, entitlements, delivery email, and customer-library ownership.
- Duplicate event IDs and out-of-order expiration/failure after payment are accepted as idempotent no-ops. Legacy webhook finalization and fulfillment remain unchanged.

## Staging evidence and limitation

- Applied only `059_native_d1_stripe_payments.sql` to `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`). Unrelated migration `052_open_store_state.sql` remains unapplied.
- An isolated Pages preview published a disposable fixed-price product and created its authoritative 500-cent native pending order through native bindings.
- The preview payment endpoint failed closed with `503` because Cloudflare does not expose the staging project production environment's encrypted Stripe key to isolated preview deployments. No real Stripe Checkout Session or test charge was created; production/staging-production secrets were not copied or weakened.
- With a disposable preview webhook signing secret, the deployed webhook rejected an invalid signature, incorrect amount, and incorrect currency; accepted the matching signed test-mode event; marked the native order paid; and preserved pending fulfillment with zero entitlements or Creator accounting. Duplicate and late expiration events were idempotent.
- Removed the order, item snapshot, webhook events, product, R2 objects, and temporary Owner session. Restored store state to `CLOSED`. A final query confirmed zero `task2h-*` products/items/sessions/events.

## Remaining integration

- A real Stripe-hosted test payment still requires an isolated environment that has a test secret key and a matching Stripe webhook endpoint. This was not available without deploying to the staging project's production environment.
- The public cart does not yet orchestrate Task 2G preparation followed by Task 2H payment.
- Entitlements, native R2 fulfillment, delivery, customer libraries, refunds, and Creator accounting remain later tasks and must consume the immutable snapshots rather than mutable catalog data.

No production resource or GitHub operational integration was used.
