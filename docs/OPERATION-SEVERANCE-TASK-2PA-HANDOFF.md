# Operation Severance Task 2P-A Handoff

## Checkpoint

- Branch: `codex/operation-severance-task1`
- Starting commit: `b575822341781bdcea458f935ac1ee1b4554be8c`
- Cloudflare staging D1: `trg-orders-staging` (`d92594e8-a45c-4f84-8f48-7c3aeba17f29`)
- Production: untouched
- GitHub operational dependency: none

## Implemented foundation

- Native fixed-price and paid-PWYW guest carts can use the existing browser checkout entry point when the staging-only guest gate is explicitly enabled.
- The browser checkout path delegates to the existing native order preparation and native Stripe payment handlers. It does not create a second order or payment implementation.
- Guest identity still requires the established verified-email record. D1 remains authoritative for product identity, availability, Creator eligibility, revision, pricing, and immutable delivery snapshots.
- Guest-paid native entitlements are created by the existing verified Stripe webhook with a null account owner and the immutable purchaser email-hash snapshot.
- The existing signed, database-backed order-access credential is the required proof of purchase control. A verified account must also have the same normalized email as the paid order.
- Claiming atomically associates both the native order and every active native entitlement with the verified account. Duplicate claims are idempotent; conflicting accounts and incomplete entitlement sets fail closed.
- My Library and secure R2 delivery work through the existing authenticated native entitlement paths after ownership is claimed. Private delivery keys remain server-only.
- Native guest checkout and native guest claiming are default-off. Runtime activation requires staging plus the exact `staging-verification` mode value. The normal staging configuration does not enable either gate.

## Schema

Migration `066_native_guest_purchase_claims.sql`:

- preserves every immutable purchase snapshot field;
- permits exactly one `purchaser_user_id` transition from null to the user already attached to the authoritatively paid native order;
- rejects reassignment, clearing, unpaid/incomplete claims, email-hash mismatches, and non-native claims at the D1 trigger boundary;
- adds a partial lookup index for unclaimed paid native guest orders.

The migration was the only pending migration and was applied to staging. The migration ledger, trigger, database UUID, and final `store_state=CLOSED` were independently verified.

## Automated verification

`scripts/test-native-guest-purchase-claim.js` covers:

- default-off browser quote and checkout gates;
- fixed-price and paid-PWYW immutable snapshots;
- verified guest email enforcement;
- one Stripe Session across a retried checkout;
- signed webhook payment and accountless entitlement creation;
- altered credential and wrong-account rejection;
- atomic authorized claim and duplicate claim idempotency;
- immutable snapshot preservation;
- My Library visibility and authenticated private-R2 PDF delivery after claim;
- continued ownership after repricing and pausing;
- unchanged registered-customer order preparation;
- no private delivery reference disclosure and no email-outbox creation.

Results:

- `npm test`: passed, including the new Task 2P-A regression.
- `npm run test:creator-product-withdrawal`: passed through its native replacement coverage.
- `npm run build:pages`: passed.
- `npm run test:pages-build`: passed.
- Pages Functions compilation with Wrangler 4.156.2: passed.
- `npm run test:storefront-visual`: passed with all locked artwork unchanged.

## Retired test maintenance

The direct `test:creator-product-withdrawal` scenario depended on repository-generated catalog mutation and mock GitHub publishing settings. It is formally retired as an executable acceptance path. The command now runs native D1/R2 Creator lifecycle coverage, including pending-submission withdrawal and published-product pause. The original file remains only because the independent inactivity regression imports its fixture utilities. See `RETIRED-CREATOR-PRODUCT-WITHDRAWAL-HARNESS.md`.

## Staging verification and limitation

- Migration 066 was verified against the real staging D1 binding while the store was CLOSED.
- An isolated Pages preview was deployed to verify configuration isolation, then overwritten with the normal disabled staging configuration.
- The required live guest browser transaction could not be completed without changing the shared staging storefront from CLOSED to OPEN. That mutation was blocked and was not bypassed.
- No disposable D1 product, identity, session, order, event, entitlement, or claim row was created.
- Two disposable R2 setup objects uploaded before the boundary was encountered were deleted; independent reads confirmed both keys are absent.
- Staging was independently confirmed CLOSED after cleanup.
- A real Stripe-hosted Checkout Session remains untested, preserving the Task 2H limitation. The signed-webhook path is covered by automated tests but was not represented as a hosted Stripe transaction.

## Task 2P-B requirements

Before either guest gate can be enabled for public use:

1. Deliver the order-access credential to the verified guest email after authoritative payment using the existing transactional outbox/provider infrastructure.
2. Add retry, bounce/suppression, and owner-recovery handling for native guest claim delivery without issuing another charge or duplicate entitlement.
3. Prove the complete email-link-to-account-claim flow in an isolated staging environment that can be opened without weakening the shared CLOSED storefront.
4. Complete a real Stripe test-mode hosted checkout when isolated preview credentials are available.
5. Only after those checks, explicitly enable guest checkout and claim modes in the intended environment.
