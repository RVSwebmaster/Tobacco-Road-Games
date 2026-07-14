# Payment staging: Work Order 2

This document records retry-safe order and Stripe Checkout Session creation for Tobacco Road Games payment-pipeline Work Order 2. It does not authorize webhooks, payment confirmation, fulfillment, email, tax, owner dashboards, live Stripe configuration, or catalog cleanup.

## Deployed environment

- Stable storefront: `https://tobacco-road-games-staging.pages.dev`
- Proof deployment: `https://8f3d4357.tobacco-road-games-staging.pages.dev`
- Remote D1 database: `trg-orders-staging`
- D1 binding: `TRG_ORDERS`
- Test product: Agency only
- Stripe mode: test only

## Retry contract

The browser creates a random UUID-v4 identifier with the `trgca_` prefix when checkout begins. It reuses that non-sensitive identifier while retrying the same email and cart in the current page. Changed client details produce a new identifier; the server remains authoritative and rejects any reused identifier whose durable request fingerprint differs.

Migration `003_checkout_attempt_idempotency.sql` adds:

- `checkout_attempt_id`, protected by a partial unique index
- an HMAC-SHA-256 `checkout_request_hash` over normalized email, cart snapshots, amount, and currency
- explicit Session lifecycle and safe failure-classification fields
- the Stripe Checkout Session URL needed to return an existing active Session

The Stripe request uses `trg-checkout-<checkout-attempt-id>` as its `Idempotency-Key`. Stripe Session and PaymentIntent metadata contain the server-controlled internal TRG order ID, public TRG order reference, and checkout-attempt identifier.

References: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) and [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)

Repeated requests first resolve the unique D1 attempt. Identical active attempts return the stored order and Session without another Stripe call. Concurrent requests may reach Stripe together, but use the same idempotency key and converge on one Session. A new attempt identifier creates a new order.

## Failure and recovery states

- Definitive Stripe 4xx rejection: payment `failed`, fulfillment `canceled`, email `skipped`, Session state `failed_terminal`, and a safe classification such as `stripe_request_rejected`.
- Connection, rate-limit, conflict, or Stripe 5xx uncertainty: payment remains `pending`, Session state becomes `retryable`, and the attempt ID plus immutable request hash remain available for replay with the same Stripe key.
- Stripe success followed by D1 attachment failure: the response is retryable. Replaying the same attempt makes Stripe return the original Session and attaches it to the original D1 order.
- Reusing an attempt with changed email, cart contents, amount, or currency: HTTP 409, no mutation, and a genuinely new attempt is required.

## Remote proof

On July 14, 2026, the deployed Agency checkout endpoint received the same attempt twice:

- Checkout attempt, safely truncated: `trgca_919deda4-f14...`
- First response: HTTP 201, `reusedCheckoutAttempt=false`
- Duplicate response: HTTP 200, `reusedCheckoutAttempt=true`
- Both responses returned the same public order and identical Stripe Checkout URL.
- Remote internal order ID: `4`
- Public order reference: `TRG-E86AF0A84167-424299E2`
- Remote order count for the attempt: `1`
- Payment status: `pending`
- Session status: `active`
- Stripe test Session ID, redacted in the repository: `cs_test_a1aTG...Fl2uJc`
- Item snapshots: one Agency item

The duplicate request returned the active Session stored by the first request; it did not create another D1 order or call Stripe again.

## Preserved Work Order 1 diagnostics

The two synthetic orders without Sessions remain in remote staging D1 and were reclassified without deletion:

- `TRG-FA971A41B0B0-446EAF0F`
- `TRG-7AEC15440205-4CBCAAB1`

Both now have:

- payment status `failed`
- fulfillment status `canceled`
- email status `skipped`
- Session status `synthetic_failure`
- failure classification `synthetic_checkout_failure`

## Verification matrix

The automated checkout-idempotency suite covers:

- duplicate sequential submissions
- duplicate concurrent submissions
- the same cart with a genuinely new attempt
- reused attempt with changed email, cart contents, amount, and currency
- definitive Stripe validation failure
- indeterminate connection failure with original-Session recovery
- indeterminate Stripe server failure
- Stripe success followed by D1 attachment failure
- recovery and attachment of the original Session

Final verification on July 14, 2026:

- Remote migration status: no migrations to apply.
- Deployed attempt gate: a valid Agency request without an attempt identifier returns HTTP 400.
- Deployed product gate: Agency accepted and Janni unavailable.
- Complete `npm test`: all eight groups passed—owner intake, owner intake UI, owner pricing editor, storefront cart, cart quote, orders D1, cart checkout, and checkout idempotency.
- Commit and clean-worktree results are recorded in the Work Order 2 handoff because a commit cannot contain its own resulting hash.

## Gate

Stop after Work Order 2 evidence is collected. Do not begin webhooks, payment confirmation, fulfillment, email, tax, owner dashboards, live Stripe configuration, or catalog cleanup until the owner reviews and accepts this work order.
