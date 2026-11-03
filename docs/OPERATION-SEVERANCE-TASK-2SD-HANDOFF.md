# Operation Severance Task 2S-D Handoff

Date: November 3, 2026  
Branch: `codex/operation-severance-task1`  
Starting commit: `824584a3ea63a5ce38866615dd8a25be75df5191`  
Environment: `tobacco-road-games-acceptance` only  
Production: untouched  
Shared staging: untouched and CLOSED

## Decision

The isolated acceptance environment is ready through the owner-provider credential boundary. Four application-owned secrets were generated independently in memory and installed as encrypted Pages secrets without printing, storing locally, or committing their values. Stripe and Resend credentials were not available and cannot be created without RV's authenticated provider access, so no real transaction or email was attempted.

| Item | Status |
| --- | --- |
| Isolated Pages/D1/R2 bindings | **PASS** |
| Application signing secrets | **PASS** |
| Disposable paid product and delivery assets | **PASS — prepared privately** |
| Stripe provider credentials and destination | **OWNER ACTION REQUIRED** |
| Resend provider credentials, verified sender, and destination | **OWNER ACTION REQUIRED** |
| RV-controlled inbox for end-to-end claim | **OWNER ACTION REQUIRED** |
| Real Stripe acceptance | **CONDITIONAL** |
| Real Resend acceptance | **CONDITIONAL** |

Neither provider can be marked PASS until RV completes the dashboard actions below and explicitly authorizes the controlled test.

## Verified isolation

Cloudflare's deployed configuration was re-read after Task 2S-C:

- Pages project: `tobacco-road-games-acceptance`
- production branch: `codex/operation-severance-task1`
- `TRG_ORDERS`: D1 `trg-orders-acceptance` (`2fff6e72-4e41-47e7-b497-992dadcab3d6`)
- `TRG_PRODUCTS`: R2 `trg-products-acceptance`
- no production or shared-staging D1/R2 reference
- `PAYMENT_PIPELINE_STAGE=staging`
- `PUBLIC_SITE_ORIGIN=https://tobacco-road-games-acceptance.pages.dev`
- `RESEND_DELIVERY_ENABLED=false`
- `NATIVE_GUEST_CHECKOUT_MODE=disabled`
- `NATIVE_GUEST_CLAIM_MODE=disabled`
- isolated store state: `CLOSED`
- orders: 0
- native entitlements: 0

Only these encrypted secret names are currently present:

- `CHECKOUT_ACCESS_COOKIE_SECRET`
- `DOWNLOAD_SIGNING_SECRET`
- `ORDER_ACCESS_SIGNING_SECRET`
- `ORDER_EMAIL_HASH_SECRET`

Their values were generated as separate 48-byte random values, piped directly to Wrangler, cleared from process variables, and never displayed.

## Prepared disposable acceptance fixture

The fixture is intentionally a nonpublic draft. It cannot be discovered or purchased while waiting for provider credentials.

- product ID: `task2sd-acceptance-product`
- slug: `task2sd-acceptance-product`
- Creator: `creator-rv-sawyer`
- publication state: `draft`
- storefront status: `coming-soon`
- pricing: fixed USD 500 cents
- cover key: `acceptance/task2sd/cover.webp`
- delivery key: `acceptance/task2sd/delivery.pdf`
- delivery filename: `task2sd-acceptance-proof.pdf`
- cover SHA-256: `9d20ed392174e6adeec8b02e6f877d63621849cb935bfa7edca2bdcbf4e1359b`
- cover size: 2,345,726 bytes
- delivery SHA-256: `511f7cb6394dc7536c2d926405a91e785b5dcc4c8e58635cc8671f068b989827`
- delivery size: 8,258,751 bytes

Both remote R2 objects were downloaded through the Cloudflare API and hash-verified after upload. The live public catalog returns zero products, a slug lookup returns 404, and `/api/store/status` returns CLOSED.

No disposable customer was created. The customer identity must use the actual RV-controlled recipient selected for the claim test so verified account ownership is meaningful.

## Exact Stripe requirement

The current integration creates Checkout Sessions server-side and explicitly accepts only a test secret beginning `sk_test_`. Although Stripe recommends restricted keys for new integrations, this code does not accept `rk_test_`; Task 2S-D must therefore use a sandbox/test-mode `sk_test_` key and rotate or revoke it after acceptance if RV prefers.

The webhook implementation requires:

- HTTPS destination: `https://tobacco-road-games-acceptance.pages.dev/api/stripe/webhook`
- event source: events on the selected sandbox/test account
- payload format: **Snapshot**, not Thin
- API version: exactly `2026-06-24.dahlia`
- minimum events:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
- endpoint-specific signing secret beginning `whsec_`

The version is non-negotiable for the current handler: it rejects an event whose `api_version` differs.

### RV Stripe dashboard steps

1. Sign in at <https://dashboard.stripe.com> and select or create a **Sandbox**. Do not use live mode.
2. Open <https://dashboard.stripe.com/apikeys> while that sandbox is selected.
3. Reveal the sandbox secret key beginning `sk_test_`. Do not paste it into chat or a command argument.
4. Open Workbench -> Webhooks at <https://dashboard.stripe.com/webhooks> and create a new event destination.
5. Select events on this account, **Snapshot** payloads, API version `2026-06-24.dahlia`, the four events listed above, and the isolated webhook URL.
6. Create the destination and reveal its endpoint-specific `whsec_...` signing secret.
7. In Cloudflare, open Workers & Pages -> `tobacco-road-games-acceptance` -> Settings -> Variables and Secrets. Add encrypted secrets:
   - `STRIPE_SECRET_KEY` = the sandbox `sk_test_...` value
   - `STRIPE_WEBHOOK_SECRET` = the isolated endpoint's `whsec_...` value
8. Save/deploy the secret update only to this acceptance project.

## Exact Resend requirement

The application sends from the fixed address `Tobacco Road Games <orders@tobaccoroadgames.com>`. Therefore the Resend account must have `tobaccoroadgames.com` itself verified for sending; verifying an unrelated domain is insufficient. The application requires a key beginning `re_`, a valid Reply-To mailbox, and a Resend webhook secret beginning `whsec_`.

The webhook implementation requires:

- HTTPS destination: `https://tobacco-road-games-acceptance.pages.dev/api/resend/webhook`
- events:
  - `email.sent`
  - `email.delivered`
  - `email.delivery_delayed`
  - `email.failed`
  - `email.bounced`
  - `email.suppressed`
- endpoint signing secret beginning `whsec_`

### RV Resend dashboard steps

1. Sign in at <https://resend.com/domains> and confirm `tobaccoroadgames.com` is verified. If it is not, add it and complete the DNS records shown by Resend before continuing.
2. Open <https://resend.com/api-keys>, create a key named `TRG isolated acceptance 2S-D`, choose **Sending access**, and restrict it to `tobaccoroadgames.com` if the dashboard offers the domain restriction.
3. Copy the one-time `re_...` value without placing it in chat, source, or shell history.
4. Open <https://resend.com/webhooks> and create the isolated endpoint with the six events listed above.
5. Copy that webhook's `whsec_...` signing secret.
6. Choose and confirm a working `RESEND_REPLY_TO` mailbox. This does not have to be the purchase recipient.
7. In Cloudflare, add encrypted secrets only to `tobacco-road-games-acceptance`:
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET`
   - `RESEND_REPLY_TO`
8. Save/deploy the secret update only to this acceptance project.

Resend documents `delivered+label@resend.dev` as a safe sink that produces a delivery event. It can be used for a separate provider-webhook check. It is not sufficient for the complete purchase-claim experience because RV must open and inspect the actual claim email. For the final end-to-end test, use a real inbox RV controls and explicitly authorizes; enter it directly in the acceptance checkout rather than sharing it in repository files.

## Exact authorization needed to resume

After completing the dashboard steps, RV should confirm only:

1. the five provider secret names are installed on `tobacco-road-games-acceptance` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_REPLY_TO`); do not reveal values;
2. `orders@tobaccoroadgames.com` is authorized by a verified Resend domain;
3. a controlled inbox is ready; and
4. RV explicitly authorizes the isolated controlled test.

At that point the acceptance run will:

1. verify secret names and endpoint configuration without reading values;
2. enable the three acceptance-only flags and redeploy only the isolated project;
3. transition the disposable product from draft to published/available-direct using revision checking;
4. establish the disposable verified customer through the controlled inbox;
5. set only `trg-orders-acceptance` OPEN for the controlled transaction;
6. complete Stripe-hosted Checkout with a Stripe test card;
7. verify signed webhook reconciliation, immutable totals, exactly one entitlement, duplicate handling, and no live-mode activity;
8. verify Resend acceptance and delivery, inspect the claim email, claim the purchase, open My Library, and hash-check the private PDF download;
9. close the isolated store before cleanup;
10. remove the disposable customer, product, order, entitlement, provider-event, session, and R2 records; disable the acceptance-only flags; and reconfirm shared staging and production were untouched.

## Current acceptance classification

- Stripe: **CONDITIONAL — owner provider credentials and authorization required**
- Resend: **CONDITIONAL — owner provider credentials, verified sender, controlled inbox, and authorization required**

Operation Severance remains technically complete and free of GitHub marketplace runtime dependencies. Task 2S-D has not demonstrated a marketplace defect; it has reached the external account-ownership boundary required by the assignment.
