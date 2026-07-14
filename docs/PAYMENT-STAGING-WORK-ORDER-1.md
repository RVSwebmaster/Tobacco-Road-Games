# Payment staging: Work Order 1

This document records the isolated Cloudflare and Stripe test environment for Tobacco Road Games payment-pipeline Work Order 1. It does not authorize live Stripe keys, payment reconciliation, fulfillment, email, owner dashboards, catalog cleanup, or any later work order.

## Staging resources

- Cloudflare Pages project: `tobacco-road-games-staging`
- Deployed storefront: `https://tobacco-road-games-staging.pages.dev`
- Production branch label used for direct uploads: `staging`
- D1 binding: `TRG_ORDERS`
- Remote D1 database: `trg-orders-staging`
- Remote D1 database ID: `d92594e8-a45c-4f84-8f48-7c3aeba17f29`
- Staging-only checkout product gate: `STAGING_CHECKOUT_PRODUCT_SLUG=agency`
- Stripe mode: test only; `functions/_lib/stripe-checkout.mjs` rejects any secret that does not begin with `sk_test_` and rejects a Stripe response marked `livemode: true`.

The production Pages project and production domain are not used by this environment.

## Remote D1 setup and migrations

The versioned D1 configuration is `ops/staging/wrangler.toml`. From `ops/staging`:

```powershell
npx wrangler d1 migrations list trg-orders-staging --remote
npx wrangler d1 migrations apply trg-orders-staging --remote
```

Both existing migrations are applied remotely. The remote schema includes `orders`, `order_items`, `webhook_events`, and the author-discussion tables.

Cloudflare D1 rejects SQL transaction-control statements such as `BEGIN IMMEDIATE TRANSACTION` with API error 7500. Pending-order creation therefore uses D1 `batch()` with one prepared order insert and all prepared item-snapshot inserts. D1 executes that batch sequentially and transactionally, rolling the complete batch back on any failure. The repository refuses atomic order creation when the database adapter lacks `batch()` support.

Reference: [Cloudflare D1 `batch()` documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

## Deployment

Cloudflare Pages discovers the `functions` directory relative to a root Wrangler configuration file and does not accept a custom Pages config path. `ops/staging/deploy.ps1` safely copies the staging-only Pages template into the repository root for the duration of the deploy, targets only `tobacco-road-games-staging`, and removes the temporary root config in a `finally` block.

Reference: [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File ops/staging/deploy.ps1
```

Do not add the staging Pages template to the repository root permanently; the production site is maintained as a separate Cloudflare Pages project.

## Required encrypted secrets

Configure these on the `production` environment of the separate `tobacco-road-games-staging` Pages project:

- `ORDER_EMAIL_HASH_SECRET`: generated random secret; configured.
- `CHECKOUT_ACCESS_COOKIE_SECRET`: generated random secret; configured.
- `STRIPE_SECRET_KEY`: Stripe test secret beginning with `sk_test_`; configure manually in Cloudflare without placing it in Git, documentation, terminal history, or chat.

After changing a secret, redeploy staging before exercising checkout.

## Agency test-product boundary

Both `/api/cart/quote` and `/api/cart/checkout` read `STAGING_CHECKOUT_PRODUCT_SLUG`. In staging it is set to `agency`, so otherwise purchasable products are rejected before an order or Stripe Session can be created. Production behavior is unchanged when that environment variable is absent.

Agency's existing R2 package was verified read-only on July 14, 2026:

- Bucket: `trg-products`
- Authoritative full object key: `agency/product.pdf`
- Full Cloudflare object path: `trg-products/agency/product.pdf`
- Size at verification: 9,630,946 bytes
- File signature: `%PDF-`

The object was not renamed, relocated, overwritten, or exposed through a public download route. The broader R2 filename audit is deferred.

## Work Order 1 verification record

- Deployed checkout preflight: `POST /api/cart/checkout` with an empty JSON body returns HTTP 400 request validation, proving the deployed route no longer returns the missing `TRG_ORDERS` binding error.
- Deployed Agency-only quote: Agency is quoted; Janni is returned as unavailable.
- Remote D1 write-path probe: public order `TRG-FA971A41B0B0-446EAF0F` exists as a pending $3.00 Agency order with one item snapshot. Its Checkout Session is intentionally null because this probe ran before the Stripe secret was configured.
- Genuine Stripe test Checkout Session and its matching remote D1 order: pending final test-secret configuration.
- Repository suite: pending final run after the genuine Checkout Session.
- Commit: pending final verification.

## Gate

Stop after collecting the completed Work Order 1 evidence. Do not begin idempotency, webhooks, payment reconciliation, R2 fulfillment, transactional email, order recovery, tax/security/monitoring/public-policy work, sandbox payment completion, live purchase/refund, or public launch until the owner reviews and accepts this work order.
