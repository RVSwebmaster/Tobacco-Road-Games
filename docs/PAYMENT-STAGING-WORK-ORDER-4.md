# Work Order 4: Secure Agency delivery

## Fixed product mapping

- Product slug: `agency`
- Private R2 bucket binding: `TRG_PRODUCTS`
- Bucket: `trg-products`
- Authoritative object key: `agency/product.pdf`
- Customer filename: `Agency.pdf`
- Content type: `application/pdf`

The object key and customer filename are server-controlled constants. The authorized download route does not accept either value from the browser. The existing public product-asset route remains restricted to `cover.webp` and `preview.webp`.

Remote R2 verification on July 14, 2026 confirmed that `trg-products/agency/product.pdf` exists, is 9,630,946 bytes, and begins with the PDF signature `%PDF-1.7`. The object was not renamed or moved.

## Fulfillment behavior

Migration `005_secure_download_entitlements.sql` adds:

- one unique entitlement per `order_items.id`;
- active and revoked entitlement states;
- object size and fixed delivery mapping snapshots;
- first, last, and total successful download tracking;
- an append-only successful-download attempt record;
- safe fulfillment failure classification on the paid order.

The verified Stripe webhook runs the idempotent paid-order repair after payment finalization. A duplicate processed webhook also runs the repair. Staging additionally exposes `POST /api/orders/repair-fulfillment` for operational recovery: it accepts only a Stripe test Session ID, retrieves that Session server-to-server with the encrypted Stripe key, revalidates the paid state and every stored order field, and only then runs the same repair. This allows an order paid across an outage or deployment boundary to recover without changing `paid_at`. R2 is checked before an order becomes fulfillment-ready. A missing or unavailable object leaves the order paid and records a recoverable fulfillment failure.

## Download authorization

Cloudflare secret name:

`DOWNLOAD_SIGNING_SECRET`

This secret must be at least 32 characters and must be generated independently of the Stripe and checkout-cookie secrets. There is no default, fallback, test value, or committed production/staging value.

Generate a cryptographically random 32-byte value locally in PowerShell without posting it in chat or logs:

```powershell
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes)
$secret | npx wrangler pages secret put DOWNLOAD_SIGNING_SECRET --project-name tobacco-road-games-staging
Remove-Variable secret, bytes
```

Redeploy the staging project after installing the secret. Never add the generated value to a repository file, `.dev.vars`, documentation, screenshots, chat, or command output.

Credentials are HMAC-SHA-256 signed, expire after 15 minutes, and bind one entitlement, order, order item, and product slug. They do not contain an R2 key or customer filename and are intentionally reusable until expiration so a browser retry does not consume the download.

## Private delivery route

`GET /store/download?credential=...`

The route validates the signature and expiration, reloads the entitlement and paid order from D1, verifies the entitlement against the fixed Agency mapping, and streams the private R2 object through the Worker. It returns `application/pdf`, `Agency.pdf`, `private, no-store`, `Content-Length` when R2 supplies it, and `X-Content-Type-Options: nosniff`.

## Manual checkpoint

Deployment was intentionally stopped before repairing the existing Work Order 3 paid order or making a new sandbox purchase. After `DOWNLOAD_SIGNING_SECRET` is installed, redeploy and resume Work Order 4. The existing paid order can then be repaired idempotently through the server-verified staging repair route or by redelivering its already-processed paid Stripe Event. Both paths use the same fulfillment repair and cannot duplicate an entitlement.

## Remote proof — July 14, 2026

Existing Work Order 3 order `TRG-28B861F71A4D-419DAF28` was repaired twice through server-side Stripe Session verification. Its original `paid_at` value remained `2026-07-14T16:14:14.000Z`, fulfillment became `ready`, and D1 retained exactly one entitlement for `agency/product.pdf` with customer filename `Agency.pdf` and size 9,630,946 bytes.

A new genuine deployed sandbox purchase produced:

- TRG order: `TRG-E670B334940C-4699AAF1`
- Stripe Checkout Session: `cs_test_a1XHrrFoo60qlGfgWncEGRSmCAl3InrpdcS3NOV9M3F9IVoORgCBuCr8sr`
- Stripe Payment Intent: `pi_3TtACp2Ou58YVanK1FffgxTn`
- Stripe Event: `evt_1TtACr2Ou58YVanK1HOXI3w3`
- Paid at: `2026-07-14T17:33:21.000Z`
- Stripe API version: `2026-06-24.dahlia`
- D1 state: `paid` and fulfillment `ready`
- Active Agency entitlements: 1

The completion page displayed `Download Agency PDF`. The private download route was fetched twice with the same unexpired credential. Both responses were HTTP 200 and 9,630,946 bytes, and D1 recorded two successful attempts while retaining one entitlement and the first successful download timestamp. Response verification confirmed:

- `%PDF-1.7` file signature
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="Agency.pdf"; filename*=UTF-8''Agency.pdf`
- `Content-Length: 9630946`
- `Cache-Control: private, no-store, max-age=0`
- `X-Content-Type-Options: nosniff`

## Repeatable Stripe duplicate-delivery verification

All staging duplicate-delivery proofs use:

```powershell
./ops/staging/resend-stripe-event.ps1 -EventId evt_...
```

The operation uses Stripe's supported `stripe events resend <event_id> --webhook-endpoint=<staging_endpoint_id> --confirm` command. It accepts only a Stripe Event ID, explicitly verifies that the Event is not live mode, discovers exactly one endpoint matching `https://tobacco-road-games-staging.pages.dev/api/stripe/webhook`, and refuses every other endpoint. The CLI response is captured and discarded so the Event payload and customer information are not printed.

Registered TRG Stripe sandbox endpoint:

- Endpoint ID: `we_1Tt8kt2Ou58YVanKsawLJ14G`
- URL: `https://tobacco-road-games-staging.pages.dev/api/stripe/webhook`
- Stripe mode: test (`livemode: false`)
- Status at verification: enabled

The first automated resend identified and corrected a timestamp idempotency defect: the duplicate could refresh `fulfillment_updated_at` even though the entitlement was already ready. The repair now verifies the private R2 object and exact active entitlement, then returns a no-op without any D1 write. Tests require both `paid_at` and `fulfillment_updated_at` to remain unchanged on duplicate repair.

Stripe CLI authorization is stored by the CLI outside the repository and is a one-time sandbox setup. No Stripe key or CLI credential belongs in this repository. The script is for deliberate staging verification only; production webhook retry handling remains fully automatic and does not depend on this operation.
