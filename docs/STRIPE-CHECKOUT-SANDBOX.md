# Stripe Checkout Sandbox

Phase 3B adds sandbox-only Stripe-hosted Checkout Session creation.

Added route:

- `POST /api/cart/checkout`

Disabled route:

- `POST /api/orders/pending`

Minimal return pages:

- `/store/checkout/complete`
- `/store/checkout/canceled`

## Phase limits

This phase intentionally does not add:

- webhooks
- payment confirmation
- order-paid transitions
- email delivery
- PDF fulfillment
- download tokens
- live deployment

## Required secrets

Do not commit these values:

- `STRIPE_SECRET_KEY`
- `CHECKOUT_ACCESS_COOKIE_SECRET`
- `ORDER_EMAIL_HASH_SECRET`

For this phase, `STRIPE_SECRET_KEY` must be a Stripe sandbox test key. The checkout code rejects non-test keys.

## Required Stripe behavior

The checkout integration creates server-authoritative Checkout Sessions with:

- `mode=payment`
- `client_reference_id=<TRG public order reference>`
- `customer_email=<confirmed buyer email>`
- server-generated `line_items`
- inline `price_data`
- `price_data[tax_behavior]=inclusive`
- `success_url=https://<site>/store/checkout/complete?session_id={CHECKOUT_SESSION_ID}`
- `cancel_url=https://<site>/store/checkout/canceled`

The browser never sends authoritative prices or Stripe Price IDs.

## Checkout-access cookie

The checkout route sets a short-lived cookie:

- name: `trg_checkout_access`
- flags: `HttpOnly`, `Secure`, `SameSite=Lax`
- path: `/store/checkout/`

This cookie exists so the Stripe Checkout Session ID is not treated as authorization by itself. The return pages compare the query-string Session ID against the cookie-backed server record and then clear the cookie.

## Cloudflare setup

Bindings and secrets must be configured outside the repo:

- Pages binding: `TRG_ORDERS`
- Pages secret: `ORDER_EMAIL_HASH_SECRET`
- Pages secret: `CHECKOUT_ACCESS_COOKIE_SECRET`
- Pages secret: `STRIPE_SECRET_KEY`

If you add or change bindings or secrets in the Cloudflare dashboard, redeploy the Pages project afterward.

## Testing

The automated test suite mocks Stripe. Running `npm test` does not require a real Stripe sandbox key.

Manual sandbox testing should be done only after:

1. creating the Stripe sandbox account resources
2. setting the Pages secrets
3. verifying the D1 migration is applied
4. ensuring no real catalog product has been made cart-purchasable unless you explicitly intend that test
