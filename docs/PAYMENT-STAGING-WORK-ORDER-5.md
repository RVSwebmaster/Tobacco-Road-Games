# Work Order 5: Customer Delivery, Recovery, and Owner Controls

## Staged architecture

- `email_outbox` is the durable D1 source of truth for transactional order messages. Its lifecycle is `pending`, `accepted`, `delivered`, `delayed`, `failed`, `bounced`, or `suppressed`.
- Every logical message has database-unique message and provider idempotency keys. Resend receives the stable key in `Idempotency-Key`; automatic retries reuse the exact payload and key.
- Automatic retry stops conservatively at 23 hours after the first attempt, before Resend's documented 24-hour idempotency-key window expires. The owner can then make an intentional, separately keyed resend without risking an invisible duplicate.
- The first delivery message is unique per order-access credential generation. An authenticated owner resend intentionally creates the next numbered logical message.
- Stripe duplicate delivery repairs fulfillment and revisits a delayed outbox row, but cannot create a second entitlement or first delivery message.
- The provider boundary is `functions/_lib/email-provider.mjs`; Resend is the current replaceable adapter.
- Order-access credentials are HMAC authenticated, stored only as SHA-256 hashes, revocable, and regenerable. The account-free page validates D1 state before issuing existing 15-minute product-specific download credentials.
- Resend webhook verification uses the untouched request body plus `svix-id`, `svix-timestamp`, and `svix-signature`. D1 uniqueness rejects replayed event processing.
- Owner order tools reuse the existing Cloudflare Access or owner-session middleware and same-origin CSRF protection. Lookups and mutations write `owner_order_audit` records.

## Routes

- Customer order delivery: `/store/order-access?credential=...`
- Private entitled PDF: `/store/download?credential=...`
- Resend webhook: `/api/resend/webhook`
- Owner page: `/owner/orders.html`
- Owner API: `/owner/api/orders`

All customer-access responses are `no-store`, send `Referrer-Policy: no-referrer`, and expose no R2 object key. The email contains no images, tracking pixels, marketing content, or third-party resources.

## Transactional message

- From: `Tobacco Road Games <orders@tobaccoroadgames.com>`
- Reply-To: `RESEND_REPLY_TO`; sending fails closed until this is a confirmed working mailbox.
- Plain text and HTML both contain the public order number, product titles, amount paid, access button/link, and support address.

## Consolidated Resend checkpoint

Do all of the following in one sitting. Do not purchase Agency until all items are complete.

1. In Resend, authorize `tobaccoroadgames.com` and finish every required Cloudflare DNS record. Confirm the domain is verified.
2. Confirm `orders@tobaccoroadgames.com` is permitted as the From address.
3. Choose and verify a working support mailbox for Reply-To. This exact address becomes `RESEND_REPLY_TO`.
4. Disable Resend open and click tracking for this transactional sending domain. The TRG message itself contains no tracking elements.
5. Create a sending-only Resend API key for staging. Do not paste it into chat, a command argument, or a repository file.
6. Register this webhook destination:
   `https://tobacco-road-games-staging.pages.dev/api/resend/webhook`
7. Select only:
   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.failed`
   - `email.bounced`
   - `email.suppressed`
8. Copy the endpoint's signing secret without exposing it in chat or logs.
9. From the canonical repository, run:
   `./ops/staging/configure-resend.ps1`
   The operation prompts securely for the API key and webhook secret, prompts for the confirmed Reply-To address, generates a separate 48-byte order-access signing secret, and installs all four values directly in Cloudflare Pages.

Exact Cloudflare names:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `ORDER_ACCESS_SIGNING_SECRET`
- `RESEND_REPLY_TO`

No default or committed value exists for any of them. The setup operation commits no credentials and does not print their contents.

## After RV completes the checkpoint

Codex will redeploy once so the new secrets are active, perform a genuine Agency sandbox purchase, verify the Resend webhook state, open the emailed link in a clean browser, verify the 9,630,946-byte `%PDF-` download, repeat the Stripe event proof, exercise provider retries, test owner lookup and intentional resend, and confirm altered/revoked/unknown access remains blocked.

## Local proof before checkpoint

`npm test` covers:

- D1 migration and outbox states
- provider and database idempotency
- retry reuse of the exact message payload and key
- invalid and valid Resend signatures
- delivered, delayed, failed, bounced, and suppressed transitions
- account-free order access and PDF download
- altered and revoked order credentials
- authenticated owner lookup, resend, repair, revoke, and regenerate operations
- audit records and unpaid fulfillment-repair rejection
- duplicate Stripe delivery producing one event, entitlement, outbox row, and provider message

Cloudflare Functions compilation must pass before each deployment.
