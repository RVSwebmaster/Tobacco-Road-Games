# Operation Severance Task 2S-C Handoff

Date: November 3, 2026  
Branch: `codex/operation-severance-task1`  
Starting commit: `90f5085f7cb3359163b2b7bc70d8c8b217538fa5`  
Configuration commit: `70e9c18c709ae5fa381878410e91e607d56bc2d2`  
Production: untouched  
Shared staging: remained CLOSED

## Result

The minimum isolated Cloudflare acceptance environment now exists, is migrated, is deployed, and is safely CLOSED. It uses dedicated Pages, D1, and R2 resources and has no binding to shared staging or production storage.

The external Stripe and Resend acceptance run stopped at the explicit credential-and-recipient boundary. The isolated Pages project's production and preview environments contain no encrypted secrets, the local process contains none of the required values, and no controlled email recipient was supplied. No Stripe Session, charge, webhook, Resend message, test customer, order, entitlement, or claim was created.

| Acceptance item | Status | Evidence |
| --- | --- | --- |
| Isolated Cloudflare environment | **PASS** | Dedicated Pages project, D1 database, and R2 bucket created; Pages deployment and native binding reads passed. |
| Stripe-hosted test checkout | **CONDITIONAL** | Environment is ready, but no isolated `sk_test_...` key or endpoint-specific webhook secret is available. |
| Resend transactional delivery | **CONDITIONAL** | Environment is ready, but no isolated API key, webhook secret, confirmed Reply-To, or controlled recipient is available. |

These are external-verification blockers, not demonstrated marketplace implementation failures and not GitHub runtime dependencies.

## Isolated resource inventory

- Pages project: `tobacco-road-games-acceptance`
- Pages production branch: `codex/operation-severance-task1`
- Canonical isolated URL: `https://tobacco-road-games-acceptance.pages.dev`
- Verified deployment: `83fe9d95-5602-4f90-89ef-f804f7dbc833`
- Deployment URL: `https://83fe9d95.tobacco-road-games-acceptance.pages.dev`
- D1 database: `trg-orders-acceptance`
- D1 database ID: `2fff6e72-4e41-47e7-b497-992dadcab3d6`
- R2 bucket: `trg-products-acceptance`
- Configuration: `ops/acceptance/wrangler.pages.toml`
- Wrangler version used: `4.44.0`

The deployed production bindings were inspected through the Cloudflare API:

- `TRG_ORDERS` -> D1 `2fff6e72-4e41-47e7-b497-992dadcab3d6`
- `TRG_PRODUCTS` -> R2 `trg-products-acceptance`
- no shared staging or production D1/R2 binding
- `PAYMENT_PIPELINE_STAGE=staging`
- `PUBLIC_SITE_ORIGIN=https://tobacco-road-games-acceptance.pages.dev`
- `RESEND_DELIVERY_ENABLED=false`
- `NATIVE_GUEST_CHECKOUT_MODE=disabled`
- `NATIVE_GUEST_CLAIM_MODE=disabled`

The Pages production and preview secret inventories are both empty.

## D1 migration and safety evidence

Before mutation, the dedicated D1 database reported exactly 69 pending migrations, from `001_direct_storefront.sql` through `069_agency_asset_recovery.sql`. All 69 existing migrations applied successfully. A second migration listing reported zero pending migrations.

Migration `052_open_store_state.sql` deliberately writes `OPEN`. Immediately after the migration batch, the isolated database was explicitly restored to:

- state: `CLOSED`
- updated by: `task_2sc_acceptance_init`

The live isolated `/api/store/status` endpoint then returned HTTP 200 with `{"state":"CLOSED","available":true,"ownerBypass":false}`.

The full ledger also creates the retired Agency continuity row from migrations 068 and 069. On this new database it has zero associated orders and zero entitlements, remains `retired` / `legacy-not-for-sale` / `buy_mode=retired`, and is not publicly discoverable. An attempted cleanup delete was rejected by the existing database trigger requiring products to be retired instead of deleted. That integrity guard was not bypassed. The acceptance bucket intentionally does not contain `agency/product.pdf`.

Post-migration isolated state:

- marketplace product rows: 1 retired Agency continuity row
- orders: 0
- native entitlements: 0
- R2 objects: 0
- `/api/catalog`: HTTP 200, zero public products

Shared staging was separately read after the isolated migration and still reported `CLOSED`, updated by `task2ob-safety-restore`. No shared staging or production database, bucket, binding, secret, deployment, or code was modified.

## Deployment and regression evidence

- Acceptance Pages allowlisted artifact: 218 files prepared.
- Pages Functions compilation with Wrangler 4.44.0: passed.
- Cloudflare deployment: passed; 216 files and the Functions bundle uploaded.
- Canonical and immutable deployment `/api/store/status`: passed and CLOSED.
- Canonical `/api/catalog`: passed and returned no public products.
- R2 object-list inspection: passed; zero objects.
- `npm run test:pages-build`: passed.
- `npm run test:operation-severance`: passed.
- `npm run test:native-d1-stripe`: passed.
- `npm run test:native-d1-entitlements`: passed.
- `npm run test:native-d1-delivery`: passed.
- `npm run test:native-guest-purchase-claim`: passed.

No application code changed, so the full suite was not rerun. The targeted provider, entitlement, delivery, claim, Pages, and Operation Severance regressions are the relevant evidence for the environment-only change.

## Exact secure credential requirements

The existing encrypted secrets on shared staging cannot be read or copied. To resume, an authorized human must enter fresh or independently retained values directly into the isolated Pages project through Cloudflare's secret UI or Wrangler's interactive `pages secret put` input. Values must not be placed in chat, source files, command arguments, shell history, or documentation.

Required isolated encrypted secrets:

1. `STRIPE_SECRET_KEY`: a Stripe test-mode secret beginning `sk_test_`. A live key is rejected by the non-production payment code and is not authorized.
2. `STRIPE_WEBHOOK_SECRET`: the `whsec_...` signing secret for the isolated Stripe webhook endpoint only.
3. `RESEND_API_KEY`: a Resend API key beginning `re_`, scoped to the test sender/domain where possible.
4. `RESEND_WEBHOOK_SECRET`: the `whsec_...` signing secret for the isolated Resend webhook endpoint only.
5. `RESEND_REPLY_TO`: a confirmed working support mailbox. This is not the test recipient.
6. `ORDER_ACCESS_SIGNING_SECRET`: a new independent random secret of at least 32 characters.
7. `CHECKOUT_ACCESS_COOKIE_SECRET`: a new independent high-entropy random secret.
8. `ORDER_EMAIL_HASH_SECRET`: a new independent high-entropy random secret.
9. `DOWNLOAD_SIGNING_SECRET`: a new independent random secret of at least 32 characters.

A separate, explicitly approved controlled recipient address or provider test sink is also required. Supplying `RESEND_REPLY_TO` does not authorize sending a purchase message to that address.

Google OAuth is not required for this acceptance run: the existing native email/password account path can establish the disposable verified customer identity using the controlled recipient.

## Provider-side actions required before resuming

### Stripe test mode

1. In Stripe test mode, provide a fresh or securely retained `sk_test_...` key to the isolated Pages project.
2. Create a Stripe webhook destination at `https://tobacco-road-games-acceptance.pages.dev/api/stripe/webhook`.
3. Configure API version `2026-06-24.dahlia` and subscribe at minimum to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
4. Enter that destination's `whsec_...` value as `STRIPE_WEBHOOK_SECRET` in the isolated Pages project.

### Resend

1. Confirm that `Tobacco Road Games <orders@tobaccoroadgames.com>` is authorized by the Resend account's verified sender/domain.
2. Provide a test-scoped `re_...` key and confirmed `RESEND_REPLY_TO` directly to the isolated Pages project.
3. Create a Resend webhook at `https://tobacco-road-games-acceptance.pages.dev/api/resend/webhook` for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, and `email.suppressed`.
4. Enter its `whsec_...` value as `RESEND_WEBHOOK_SECRET`.
5. Explicitly designate the controlled recipient or provider test sink for the one acceptance purchase.

## Safe resume sequence

After the prerequisites are installed:

1. Verify secret names without displaying their values.
2. Change only the isolated config to `RESEND_DELIVERY_ENABLED=true`, `NATIVE_GUEST_CHECKOUT_MODE=staging-verification`, and `NATIVE_GUEST_CLAIM_MODE=staging-verification`; redeploy only the acceptance project.
3. Seed/publish one disposable paid native product and its private PDF into the isolated D1/R2 resources.
4. Establish the controlled verified customer/guest identity.
5. Set only `trg-orders-acceptance` to OPEN immediately before the controlled purchase.
6. Complete one actual Stripe-hosted test checkout using a Stripe test payment method.
7. Verify the signed Stripe webhook, immutable amount, one paid transition, exactly one entitlement, duplicate-event idempotency, My Library visibility, and exact private R2 download bytes.
8. Verify one actual Resend message, provider acceptance, delivery webhook status where available, claim content, claim authorization, and duplicate-message suppression.
9. Return the isolated store to CLOSED before cleanup; remove all disposable products, assets, sessions, orders, events, entitlements, and identities while preserving the reusable empty environment.
10. Reconfirm shared staging is CLOSED and production is untouched.

## Production rollout status

The reusable isolated Cloudflare environment requirement is complete. Stripe and Resend remain **CONDITIONAL** until the human-supplied credentials and controlled recipient enable actual external transactions. Operation Severance remains free of GitHub marketplace runtime involvement; no GitHub operation is needed by this environment or the eventual acceptance flow.
