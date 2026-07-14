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
