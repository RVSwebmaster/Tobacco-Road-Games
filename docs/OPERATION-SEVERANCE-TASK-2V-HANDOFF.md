# Operation Severance — Task 2V Handoff

Date: 2026-11-05  
Branch: `codex/operation-severance-task1`  
Starting commit: `f69118c06a0ded7159a7f4593b34dde89711c105`  
Scope: production-preview isolation, native live-payment readiness, and production rollout planning. No deployment, migration, payment, email, or production write was performed.

## Outcome

Task 2V's code and configuration work is complete. Native D1 checkout can now create a Stripe live-mode Checkout Session only when all production controls agree, while acceptance, staging, previews, and tests remain unable to execute a live payment. A checked-in Pages environment manifest makes the production project's preview environment read-only and gives it no D1 or R2 binding.

The remote production Pages project has **not** been changed because this task forbids production changes. Its currently deployed preview configuration therefore still points `TRG_ORDERS` at shared staging until the checked-in manifest is applied during the separately authorized rollout. Do not use that existing preview for marketplace testing before then.

Acceptance, shared staging, and production were rechecked read-only after implementation and all remain `CLOSED`. The current production deployment remains `0496b997-a63e-44c9-82a0-59ed66599843`; production was untouched.

## A. Production preview isolation

### Root cause

The production Pages project was dashboard-managed without a checked-in Pages manifest. Its `preview` deployment configuration explicitly bound `TRG_ORDERS` to shared-staging D1 `d92594e8-a45c-4f84-8f48-7c3aeba17f29`. Pages applies preview configuration to every preview branch, so this was an environment configuration error rather than a D1 or application-routing defect.

### Correction

`ops/production/wrangler.pages.toml` is now the reviewed source manifest:

- `[env.preview.vars]` sets `MARKETPLACE_WRITE_POLICY=disabled`, `PAYMENT_PIPELINE_STAGE=preview`, live checkout disabled, guest checkout/claim disabled, and Resend delivery disabled;
- preview has no D1 or R2 binding, so it cannot read or mutate shared staging or production marketplace data;
- root middleware rejects every non-read-only preview request before route code can reach a binding or external provider;
- `[env.production]` names only production D1 `7e2cd675-a6f1-4fac-bbc9-03485a806c26` and R2 `trg-products`;
- production live checkout and Resend remain disabled in the committed manifest. Enabling either is an explicit rollout decision, not an accidental side effect of deployment.

Acceptance and both maintained staging manifests explicitly preserve their existing writable staging behavior and keep native live checkout disabled.

`scripts/test-pages-environment-isolation.js`, included in `npm test` pretest, pins these rules and rejects staging/acceptance IDs, provider credentials, D1/R2 preview bindings, or enabled preview provider gates.

## B. Native Stripe live-payment boundary

`functions/_lib/native-stripe-payment.mjs` no longer hard-codes the staging pipeline when creating a Session. Production Session creation now requires all of the following:

1. `PAYMENT_PIPELINE_STAGE=production`;
2. `NATIVE_LIVE_CHECKOUT_MODE=production-enabled`;
3. an `sk_live_` Stripe credential;
4. a valid HTTPS `PUBLIC_SITE_ORIGIN` exactly matching the request origin;
5. the existing `OPEN` store-state check;
6. the existing authenticated/verified purchaser, immutable order, current catalog revision, availability, price, currency, fulfillment snapshot, and idempotency checks.

Staging still requires an `sk_test_` credential. `preview` and any unknown pipeline stage fail closed before Stripe is called. Stripe's Session response must still report the exact expected `livemode` value and hosted-page UI mode before it can be attached to D1.

Webhook processing already supported correctly signed live-mode events in the production pipeline. It now also rejects a missing or unknown pipeline stage before reconciling an order. Existing signature, API-version, Session/order association, amount, currency, mode, duplicate-event, order-transition, entitlement, and fulfillment checks remain intact.

The committed production manifest intentionally leaves `NATIVE_LIVE_CHECKOUT_MODE=disabled`. The code is ready; commerce is not enabled.

## C. Verification

### Passed

- `npm run test:pages-environment-isolation`
- `npm run test:native-d1-stripe`
- `node scripts/test-stripe-webhook.js`
- `node scripts/test-cart-checkout.js`
- `node scripts/test-checkout-idempotency.js`
- full `npm test`, including the new preview-isolation pretest
- `npm run build:pages` — 218 allowlisted files
- `npm run test:pages-build`
- `npm run test:native-d1-entitlements`
- `npm run test:native-d1-delivery`
- `npm run test:operation-severance`
- `npm run test:storefront-visual` — all RV-locked storefront baselines unchanged
- Wrangler 4.44.0 Pages Functions compilation — `Compiled Worker successfully`
- `git diff --check`

The live-mode regression uses a mocked Stripe transport. It proves configuration, request construction, immutable 500-cent order use, live/test mode matching, production-origin enforcement, and fail-closed behavior without a charge or a live credential.

An additional local `wrangler pages dev` startup was not completed because the desktop approval service hit its usage limit. This is not a code or manifest failure: the same pinned Wrangler 4.44.0 executable successfully compiled the complete Pages Functions bundle, and the manifest-specific regression passed. No remote fallback was attempted.

### Environment evidence

Read-only Cloudflare checks after implementation:

| Environment | D1 state | Result |
| --- | --- | --- |
| Acceptance | `CLOSED` | Unchanged |
| Shared staging | `CLOSED` | Unchanged |
| Production | `CLOSED` | Unchanged |

The remote production preview binding is still the old shared-staging D1 ID. Applying the reviewed preview manifest is deliberately deferred to the authorized production rollout.

## D. Exact production rollout sequence

This is a plan only. Every production-changing step requires separate Owner authorization.

1. **Freeze and capture the baseline while CLOSED.** Confirm production, shared staging, and acceptance are `CLOSED`; record deployment `0496b997-a63e-44c9-82a0-59ed66599843`; export production D1; inventory production R2; record migration ledger, schema, row counts for orders, order items, entitlements, users, sessions, and existing runtime settings; retain the export and R2 inventory outside the deployment artifact.
2. **Reconcile the Pages manifest before deployment.** Download/read the current Pages production and preview configuration; compare every binding and secret name with `ops/production/wrangler.pages.toml`; preserve required opaque production authentication, CSRF, order, download, forum, and Office secrets without copying values into source. Remove the dormant `GITHUB_TOKEN` only after confirming the already-zero runtime scan. Do not copy any acceptance/staging provider secret into production.
3. **Apply preview isolation first.** Apply the checked-in `env.preview` configuration to the production Pages project on a non-production branch. Verify the resulting preview has no `TRG_ORDERS`, `TRG_PRODUCTS`, Stripe, or Resend binding; verify POST to a marketplace endpoint returns 503; verify no shared-staging row or R2 object changes. Do not continue if the dashboard still shows staging D1 on preview.
4. **Prepare production-only provider configuration while CLOSED.** Install a production Stripe live secret and the production endpoint's webhook signing secret; configure the live webhook for the maintained event set and pinned API version. Configure the verified production Resend sender, API key, webhook secret, and reply-to address. Keep `NATIVE_LIVE_CHECKOUT_MODE=disabled`, `RESEND_DELIVERY_ENABLED=false`, both guest gates disabled, and the store `CLOSED`.
5. **Restore the authoritative Agency asset before migration 069 can reference it.** Promote only the approved 9,630,946-byte Agency PDF to production R2 key `agency/product.pdf`, with explicit authorization. Download it back and require SHA-256 `c503aad77f0736814c578683c0ff50fb83a4ed4ac4a67e823aa141a87a3572c9`, PDF signature, size, and `application/pdf`. Do not substitute content. If this source promotion is not authorized, stop before migrations 068–069.
6. **Apply production migrations in ledger order.** Re-list pending migrations and require exactly `057` through `069`, then apply only this reviewed sequence: `057_marketplace_product_catalog`, `058_native_d1_order_foundation`, `059_native_d1_stripe_payments`, `060_native_paid_purchase_entitlements`, `061_secure_native_product_delivery`, `062_native_free_product_acquisition`, `063_homepage_configuration`, `064_creator_native_submission_pricing`, `065_creator_native_review_publication`, `066_native_guest_purchase_claims`, `067_native_guest_claim_credentials`, `068_agency_legacy_continuity`, `069_agency_asset_recovery`. Keep production CLOSED throughout.
7. **Verify data preservation before code deployment.** Confirm all thirteen ledger entries; compare pre/post counts and immutable historical order values; confirm old orders and entitlements were neither deleted nor duplicated; confirm exactly one retired `legacy:agency` identity at revision 2; confirm the four historical-only products were not published; confirm the Agency R2 digest; confirm no public product became purchasable.
8. **Deploy the reviewed Task 2V commit to production while CLOSED.** Use `ops/production/wrangler.pages.toml`; verify production D1/R2 IDs after deployment; verify live checkout, guest gates, and Resend remain disabled; verify no GitHub runtime binding or call; verify the production origin and current commit headers.
9. **Run CLOSED post-deploy validation.** Exercise public catalog/product reads, owner and creator authorization, cart quote rejection while CLOSED, account/library ownership reads, Agency entitlement authorization, private R2 delivery, webhook signature rejection, and preview POST denial. Do not send email or create a Session.
10. **Authorize provider acceptance separately.** Only after Steps 1–9 pass, change `NATIVE_LIVE_CHECKOUT_MODE` to `production-enabled` under a reviewed production config change. Conduct one separately authorized live-payment acceptance procedure with the store opened only for the controlled account/product window; verify signed webhook, exact amount/currency, one entitlement, Library, and exact private PDF; return the store to CLOSED. Enable Resend or guest purchasing only through their own approved acceptance/launch decision.
11. **Open commerce only by explicit Owner decision.** Reconfirm migrations, provider event delivery, store state, monitoring, close-store procedure, and customer support readiness immediately before changing `runtime_settings.store_state`.

### Rollback and recovery

- **Code/config failure:** immediately set/confirm `CLOSED`, disable live checkout and Resend, and roll Pages back to the recorded deployment. Re-check that preview has no writable binding; a code rollback must not restore the unsafe preview configuration.
- **Migration failure:** keep the store CLOSED and stop. Pages rollback does not roll back D1 or R2. Preserve logs and the failed database, then use a reviewed forward repair or restore the captured D1 export into an approved recovery database and rebind only after validation. Never improvise reverse `ALTER TABLE` operations on production.
- **Provider failure:** keep the paid order and webhook evidence immutable, disable Session creation, and retry idempotent fulfillment only through maintained recovery paths. Never manually mark an order paid.
- **R2 failure:** do not delete existing objects. Restore only the checksum-verified source to its exact key; leave entitlements intact and fail delivery closed until byte integrity is proven.

## E. Remaining Owner actions / blockers

1. Authorize applying the preview-isolation configuration to the production Pages project. Until then, the existing remote preview remains unsafe and must not be used.
2. Authorize and supply production-only live Stripe and Resend credentials through Cloudflare encrypted secrets, plus provider endpoint/sender configuration. No credential value is needed in chat or source.
3. Approve the D1 backup, Agency asset promotion, migrations `057`–`069`, and CLOSED production deployment.
4. Separately authorize the controlled live-money acceptance transaction and later store opening. The committed gate remains disabled until then.

No other code blocker to native production live-mode Session creation was found.

## F. Changed files

- `functions/_middleware.js`
- `functions/_lib/preview-write-policy.mjs`
- `functions/_lib/native-stripe-payment.mjs`
- `functions/_lib/stripe-checkout.mjs`
- `functions/_lib/stripe-webhook.mjs`
- `ops/acceptance/wrangler.pages.toml`
- `ops/staging/wrangler.pages.toml`
- `ops/staging/wrangler.toml`
- `ops/production/wrangler.pages.toml`
- `scripts/test-pages-environment-isolation.js`
- `scripts/test-native-d1-stripe-payments.js`
- `package.json`
- `docs/OPERATION-SEVERANCE-TASK-2V-HANDOFF.md`

