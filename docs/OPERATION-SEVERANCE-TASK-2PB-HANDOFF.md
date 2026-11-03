# Operation Severance Task 2P-B Handoff

## Checkpoint

- Branch: `codex/operation-severance-task1`
- Starting commit: `548f6770cbdc0f77b46ce0829ac3349fb2bde877`
- Cloudflare staging D1: `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`)
- Production: untouched
- Shared staging store: remained `CLOSED`
- GitHub operational dependency: none

## Implemented guest notification and claim experience

- Verified Stripe payment processing now grants native entitlements before creating a guest claim notification.
- The existing Resend outbox and provider idempotency key are reused. A retryable provider failure leaves the paid order and entitlements intact; a duplicate Stripe webhook retries the same message payload and provider key instead of issuing another order, entitlement, or notification.
- Native guest messages contain the immutable order reference, titles, amount paid, and a signed claim link. They contain no private R2 key, purchaser hash, order-item identifier, or internal entitlement record.
- Native claim credentials expire after 30 days. Successful claims bind a credential immutably to the verified account. Same-account retries are idempotent; another account and expired credentials fail closed.
- The order-access page recognizes native guest purchases and leads into the existing Account / My Library recovery interface. The claim credential is removed from the visible account URL and retained only for the current tab until the claim succeeds.
- The existing verified-email requirement remains authoritative. A successful claim atomically associates the paid order, all active native entitlements, the audit record, and the credential consumption marker.
- The checkout return page now tells native guests that secure claim instructions follow verified payment, instead of incorrectly waiting on legacy fulfillment state.
- The live browser pass found and fixed two integration defects: the account form used `event.currentTarget` after an async boundary, and the claim Pages route did not adapt the Pages context object to the request handler.
- `_routes.json` now includes the already-existing authenticated account profile endpoint so the claim screen does not display a static 404 parsing error.
- Native guest checkout and claiming remain default-off. The isolated verification preview was overwritten after testing with both guest modes disabled and without disposable signing values.

## Schema

Migration `067_native_guest_claim_credentials.sql` adds nullable fields to `order_access_credentials`:

- `expires_at`
- `consumed_at`
- `consumed_by_user_id`

It also adds an expiration index and an immutability trigger that permits a credential to become consumed exactly once. Nullable fields preserve existing legacy delivery-link behavior.

Before applying the migration, Wrangler reported only migration 067 pending and `store_state=CLOSED`. Migration 067 applied successfully to the remote staging database. The ledger, all three columns, the trigger, database UUID, and final CLOSED state were verified. No migrations remain pending.

## Automated verification

The targeted native guest test covers:

- no notification during order preparation;
- fixed and PWYW immutable paid snapshots;
- verified signed-webhook payment and entitlement creation;
- injected retryable email-provider failure;
- duplicate-webhook recovery using one outbox row, one exact payload, and one provider idempotency key;
- guest claim email content and private-reference non-disclosure;
- disabled claim gate;
- wrong-account and altered-token rejection;
- 30-day expiry and expired-token rejection;
- atomic credential consumption and entitlement association;
- duplicate same-account claim idempotency;
- My Library visibility and authenticated private-R2 PDF delivery;
- continued ownership after product repricing and pausing;
- registered-customer compatibility;
- real Pages route-adapter and route-allowlist wiring.

Results:

- `npm run test:native-guest-notification-claim`: passed.
- Full `npm test`: passed.
- `npm run build:pages`: passed.
- `npm run test:pages-build`: passed.
- Wrangler 4.156.2 Pages Functions compilation: passed.
- `npm run test:storefront-visual`: passed; locked storefront artwork was unchanged.
- Existing Stripe webhook, customer delivery, account UI, and Marketplace Pass 4 compatibility tests passed.

## Native staging browser evidence

An isolated Pages preview used native staging D1/R2 bindings and disposable preview-only signing values while the shared store remained CLOSED.

1. A disposable paid native order and accountless entitlement were created through the deployed signed test-mode webhook path.
2. The actual order-access page displayed the correct order and product and linked into Account / My Library.
3. A different verified account was rejected through the actual browser interface.
4. The matching verified purchase account claimed the order through the actual browser interface.
5. My Library immediately displayed one product with the immutable title, Creator (`RV Sawyer`), order reference, `$7.25` purchase amount, and purchased version `2P-B`.
6. The browser downloaded `Task 2P-B Purchased.pdf` through the authenticated native entitlement route.
7. Reusing the consumed link reported that the purchase was already in an account and created no second successful audit or entitlement.
8. Expiring the disposable credential caused the link to fail while the claimed product and its authenticated download action remained visible in My Library.
9. D1 independently confirmed one consumed credential, one buyer-owned entitlement, one successful claim audit, and `store_state=CLOSED`.

Cleanup removed the disposable product, order, order items, event, credential, entitlement, claim audit, sessions, users, password credentials, cover object, delivery object, generated fixtures, and locally downloaded PDF. Independent D1 counts were zero, both exact R2 keys returned “does not exist,” and staging remained CLOSED.

## Limitations before guest purchase activation

- No real Stripe-hosted Checkout Session was completed. Isolated Pages previews still do not receive the staging project's encrypted Stripe test credential, preserving the Task 2H limitation. The deployed proof used the existing correctly signed test-mode webhook path and did not represent a hosted checkout as tested.
- No real transactional email was sent. The isolated preview does not receive the staging project's encrypted Resend credential, and no controlled external recipient or email sink binding was available. Email generation, provider submission, retry, idempotency, and private-data exclusion were verified with the injected provider harness, but external acceptance/delivery/bounce behavior remains unproven.
- Guest checkout and native guest claim modes must remain disabled until a safely isolated preview has both Stripe test credentials and a controlled Resend sink/recipient, then completes a real hosted checkout-to-email-to-claim pass.
