# Payment staging: Work Order 3

This document records the verified Stripe payment-confirmation design for Tobacco Road Games Work Order 3. The manual Stripe endpoint registration and genuine Agency sandbox purchase are gated checkpoints; fulfillment, downloads, email, tax, owner dashboards, refunds, disputes, live Stripe work, and catalog cleanup remain out of scope.

## Staging event destination

- HTTPS endpoint: `https://tobacco-road-games-staging.pages.dev/api/stripe/webhook`
- HTTP method: `POST`
- Cloudflare encrypted secret: `STRIPE_WEBHOOK_SECRET`
- Stripe API version: `2026-06-24.dahlia` (stable GA; not preview)
- Environment: Stripe sandbox/test mode only

Register only these event types:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Store the endpoint-specific `whsec_...` value as the Cloudflare Pages secret named above. Never place it in source control, chat, deployment output, screenshots, or ordinary logs. Redeploy the staging project after adding or rotating the secret.

## Signature and mode controls

The handler reads the request body exactly once as raw bytes. It verifies the `Stripe-Signature` HMAC against those untouched bytes before decoding JSON, accepts only signatures within a five-minute tolerance, and never logs the signing secret or raw payload. Missing or invalid signatures are rejected before D1 is touched.

Checkout Session creation sends the explicit `Stripe-Version: 2026-06-24.dahlia` request header. The Stripe event destination must use that same explicit stable version. Events with another API version fail safely and remain reviewable. The staging handler rejects live-mode events and any Session whose mode does not match its Event.

The Clover-to-Dahlia review identified one breaking Checkout change used by this pipeline: Dahlia replaces the `hosted` UI mode with `hosted_page`. TRG now explicitly creates hosted Sessions with `ui_mode=hosted_page`, requires Stripe's creation response to report that value, and reconciles the same value from webhook Session snapshots. A fixture using the retired `hosted` value must fail without changing the order. Dahlia's `integration_identifier` is additive and optional. The Checkout Session metadata, Payment Intent, amount, currency, `payment_status`, and four selected event types used by TRG remain part of the Dahlia contract.

References: [Stripe Dahlia changelog](https://docs.stripe.com/changelog/dahlia), [Dahlia Checkout UI mode change](https://docs.stripe.com/changelog/dahlia/2026-03-25/updates-available-checkout-session-ui-modes), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature), [Stripe webhook handling](https://docs.stripe.com/webhooks), and [Stripe API versioning](https://docs.stripe.com/api/versioning).

## Durable processing contract

Migration `004_verified_stripe_webhooks.sql` extends the existing `webhook_events` table. Its pre-existing uniqueness constraint on `(provider, provider_event_id)` guarantees one row per Stripe Event ID. The new columns record attempt count, a reclaimable processing lease, safe failure classification, Stripe identifiers, mode, amount, currency, and the pinned API version.

- A processed or ignored duplicate returns success without processing again.
- A failed event clears its lease and remains retryable under the same unique record.
- An interrupted processing lease becomes reclaimable after five minutes.
- Order state and successful event finalization use one D1 `batch()` transaction.
- A transaction failure rolls back the order change, records a retryable event failure when possible, and returns a server error so Stripe retries.

## Reconciliation and order transitions

Before changing an order, the handler reconciles:

- the internal TRG order ID in server-controlled Session metadata
- the public TRG order reference and checkout-attempt identifier
- Stripe Checkout Session ID
- Stripe Payment Intent ID
- total amount and currency
- Stripe API version
- test/live mode

Any mismatch leaves the order unpaid and records a safe reviewable failure code. A matching paid completion or asynchronous-success event sets payment status to `paid`, records `paid_at`, and attaches the Payment Intent ID. A completed Session whose `payment_status` is not `paid` remains pending. Expiration and asynchronous failure update only pending orders, so neither can downgrade an already-paid order.

## Customer return page

The Stripe browser return is never treated as proof of payment. The signed checkout-access cookie and Session ID locate the D1 order; the page then renders only D1 state:

- pending or otherwise unpaid: **Payment processing**
- paid: **Payment confirmed**

The pending page retains the short-lived signed cookie so the customer can refresh. The paid page clears it. Neither state exposes downloads or claims fulfillment.

## Manual checkpoint

Deploy the endpoint and migration, then stop. The owner must register the sandbox event destination and add its endpoint signing secret to Cloudflare. Only after the owner confirms that secret is installed may the staging project be redeployed and a genuine Agency purchase be performed.

The owner completed this checkpoint on July 14, 2026. The encrypted `STRIPE_WEBHOOK_SECRET` was present in Cloudflare before the post-configuration deployment. An invalid-signature probe then returned HTTP 400 and left `webhook_events` empty, proving the deployed endpoint had advanced from configuration gating to signature verification.

## Final remote evidence

Deployment after secret installation: `https://92f0b950.tobacco-road-games-staging.pages.dev`

A genuine Stripe sandbox card purchase of Agency completed through the deployed storefront:

- Internal D1 order ID: `5`
- Public TRG order reference: `TRG-28B861F71A4D-419DAF28`
- Checkout attempt, safely truncated: `trgca_ee8f9f04-2477-...`
- Stripe test Checkout Session: `cs_test_a1E9UEEDiVAGH0uXvkmXRDCMHXKk2OalkmCeFb8JZuDyYJywg2e4f4VNBR`
- Stripe test Payment Intent: `pi_3Tt8yH2Ou58YVanK0lsB80Mn`
- Stripe Event: `evt_1Tt8yI2Ou58YVanKNU6JYmDy`
- Event type: `checkout.session.completed`
- API version recorded from the Event: `2026-06-24.dahlia`
- D1 total: `300 USD`
- D1 payment status: `paid`
- D1 paid timestamp: `2026-07-14T16:14:14.000Z`
- Webhook processed timestamp: `2026-07-14T16:14:14.678Z`
- Order item snapshot: one Agency item at `300 USD`

The customer return page displayed **Payment confirmed** and stated that fulfillment is not enabled. It did not expose a download or treat the browser return as payment proof; the displayed state came from the paid D1 order.

The owner manually redelivered that exact Stripe Event from Workbench. Remote D1 still contained exactly one row for the Event, with `processing_status=processed`, `processing_result=paid`, and `attempt_count=1`. The order remained paid with the original paid timestamp. This demonstrates that a successfully processed duplicate returns before claiming or mutating the Event or order again.

The complete repository test command passed all nine groups: owner intake, owner intake UI, owner pricing editor, storefront cart, cart quote, orders D1, cart checkout, checkout idempotency, and Stripe webhook. The Cloudflare Pages Functions bundle also compiled successfully before deployment.
