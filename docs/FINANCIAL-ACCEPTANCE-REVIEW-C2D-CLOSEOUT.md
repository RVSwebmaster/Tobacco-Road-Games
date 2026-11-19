# C2D — Independent Financial Review Closeout

Date: 2026-11-18  
Scope: implementation and isolated verification of findings F-01 through F-07 in `TRG-FINANCIAL-ACCEPTANCE-REVIEW.md`.

## Disposition summary

| Finding | Disposition | Result |
|---|---|---|
| F-01 | ADOPT | Native D1 checkout is exclusive for newly initiated paid product purchases. Existing active legacy sessions and historical processing remain recoverable. |
| F-02 | ADAPT | Active paid Preferred classification resolves to Premier 95/5 without granting status; historical transaction terms remain unchanged. |
| F-03 | ADAPT | Existing assignment/revocation operations are available in audited Owner Office UI, with a database-enforced 25-active-assignment cap. |
| F-04 | ADOPT | Actual native webhook sequence verifies delayed fee reconciliation and payout hold. |
| F-05 | ADAPT | Migration preservation is tested; synthetic category defaults are explicitly unverified and excluded from confident historical classification. |
| F-06 | ADOPT | Invalid, incomplete, or inconsistent Stripe fee evidence is held for Owner review, not reconciled. |
| F-07 | ADOPT | Positive processing-fee allocation across product and non-product consideration is tested for exact integer-cent reconciliation. |

## Implementation and evidence

### F-01 — Retire legacy paid checkout

`functions/_lib/cart-checkout.mjs` rejects newly initiated paid legacy-catalog purchases before a legacy order or Stripe Checkout Session can be created. Native D1 checkout remains the sole new paid path. A matching pending legacy order can resume a previously created, active Stripe Checkout Session when its request hash matches; this avoids abandoning an already initiated payment. A changed request conflicts, and an inactive/unstarted legacy attempt cannot create a new paid session. Existing webhook settlement, fulfillment, entitlements, refunds, disputes, and Owner recovery were retained. Legacy free acquisition remains available.

Evidence: `scripts/test-cart-checkout.js` verifies fail-closed paid fixtures, no new Stripe session/order, active-session resumption without another Stripe call, and free acquisition. `scripts/test-checkout-idempotency.js` verifies repeated new legacy paid attempts remain rejected. Native checkout/idempotency is exercised in native Stripe tests.

### F-02 — Financial policy consistency

`docs/MARKETPLACE-POLICY-CANON.md` now aligns the current approved categories: Standard 90/10; Owner-assigned Founding-25 95/5; Premier 95/5; Owner 100% house; Admin 100% TRG with no Creator compensation. Active paid Preferred status maps to the Premier *financial classification* only; it does not grant, renew, or otherwise imply a paid Preferred entitlement. Historical Preferred terminology and historical 80/20 Standard / 90/10 Preferred transaction terms remain historical. Immutable snapshots and ledger entries are not rewritten.

Evidence: `scripts/test-c2d-policy-upgrade-and-founding25.js`, `scripts/test-native-stripe-fee-reconciliation.js`, and the marketplace financial regressions.

### F-03 — Founding-25 management

`functions/owner/api/founding25.js` exposes an Owner-only action backed by `functions/_lib/founding25-owner.mjs`. The action requires an authenticated active Owner, same-origin request, session CSRF token, explicit action confirmation, Creator ID, and reason. It calls existing audited assignment/revocation functions. `owner/finance.html` and `assets/js/owner-founding25.js` provide the management and assignment-history UI. Migration `076_financial_classification_and_founding25_limit.sql` adds database constraints preventing more than 25 active/reserved distinct Creator assignments, including concurrent assignment attempts, and prevents duplicate active assignments for one Creator. The historical badge is not a grant mechanism. Revoked seats remain unassigned until an explicit Owner assignment; assignment history and transaction snapshots persist.

Evidence: `scripts/test-c2d-policy-upgrade-and-founding25.js` checks authorization, CSRF, confirmation/audit, the seat-25 concurrent race, revocation/history, and absence of automatic reallocation.

### F-04 — Delayed Stripe fees through the native webhook

The isolated native payment regression processes the signed payment-success event while fee details are unavailable, then confirms delivery and a held/unpayable Creator earning. It subsequently sends a signed `charge.updated` event through the native webhook with the Balance Transaction fee available. The test verifies reconciliation occurs once and that fee reserves do not become payable prematurely.

Evidence: `scripts/test-native-d1-stripe-payments.js` exercises the webhook handler and provider fetch mock. This verifies the handler path with isolated resources; it does not access Stripe production.

### F-05 — Historical migration preservation

Migration `076_financial_classification_and_founding25_limit.sql` marks preexisting compatibility category values as unverified rather than representing them as established historical classifications. Existing order amounts, immutable item amounts, sale snapshots, and ledger totals are preserved. Finance reconciliation identifies unclassified historical rows rather than asserting that synthetic defaults were the Creator's actual category. Newly snapshotted C2C transactions carry verified policy classification; where historical classification was not evidenced, downstream compensation checks rely on actual ledger evidence rather than a synthetic category.

Evidence: `scripts/test-c2d-policy-upgrade-and-founding25.js` seeds financial records before applying the new migrations and compares their financial values and ledger totals after migration. No production database was inspected or backfilled. This establishes migration behavior against the seeded fixture, not the contents/classifications of any production historical order.

### F-06 — Stripe fee-detail validation

`functions/_lib/stripe-order-fees.mjs` validates supported fee-detail types, safe nonnegative integer amounts, detail currencies, and exact equality between the sum of fee details and the Balance Transaction fee. Missing, malformed, wrong-currency, or inconsistent details go to `needs_review`; no item allocation is written and earnings remain held. A `needs_review` result is not silently promoted by retry. Provider evidence remains recorded for Owner intervention.

Evidence: `scripts/test-native-stripe-fee-reconciliation.js` covers incomplete/inconsistent total and currency cases and verifies no fee allocation or payout release. Valid detail totals reconcile exactly.

### F-07 — Positive non-product fee allocation

The fee test sends a paid native webhook for a transaction containing a product amount, positive tax, and positive other non-product consideration. It then reconciles an actual positive processing fee and asserts positive allocations to each relevant contribution, deterministic minor-unit remainder handling, and exact sum equality. Processing fees on TRG-owned products remain absorbed by TRG; nonprocessing fee components are not silently charged to Creators.

Evidence: `scripts/test-native-stripe-fee-reconciliation.js` validates exact totals, item allocations, account-category treatment, and nonprocessing fee separation.

## C2B implementation status confirmed

- **Stripe Express Dashboard:** `functions/_lib/stripe-connect-sandbox.mjs::createConnectAccount()` creates Express accounts with transfers capability. That account type supports Stripe-hosted Express management, but TRG has no account login-link endpoint/action. Integration remains unfinished; C2D only confirmed status.
- **CSV formula protection:** `functions/_lib/creator-business-report.mjs::csv()` and `functions/_lib/creator-finance.mjs::csv()` quote/escape CSV syntax but do not neutralize formula-leading cells. Formula injection protection remains unfinished and was not part of C2D implementation.

## Verification

Focused isolated regressions passed:

- `node scripts/test-cart-checkout.js`
- `node scripts/test-checkout-idempotency.js`
- `node scripts/test-native-d1-stripe-payments.js`
- `node scripts/test-native-stripe-fee-reconciliation.js`
- `node scripts/test-native-creator-earnings.js`
- `node scripts/test-c2d-policy-upgrade-and-founding25.js`
- `node scripts/test-marketplace-pass7.js`
- `node scripts/test-marketplace-pass8.js`
- `node scripts/test-marketplace-pass9.js`
- `node scripts/test-marketplace-pass10.js`

The final `npm run verify:launch` result is recorded in `docs/LAUNCH-VERIFICATION-RESULT.json`. Any isolated remote-only Creator submission staging check is reported as blocked, distinct from failed tests. Approved visual baselines were not regenerated.

## Boundaries and remaining limitations

No production access, live financial operations, Creator transfers, deployed database migration, deployment, or commit occurred. Existing unrelated uncommitted work was preserved. Active legacy sessions continue only to complete already initiated transactions; no fresh paid purchase can begin through that route. Production historical categories and orders were not inspected, so no claim is made that seeded historical classifications represent production truth. Express Dashboard login links and CSV formula neutralization remain separate unfinished integrations.

### Final launch-gate record — 2026-11-18

`npm run verify:launch`: **PASS_WITH_SEPARATE_CHECKS_PENDING**; launch-critical outcome **PASS**; **69 passed, 0 failed, 0 skipped, 1 blocked**. The blocked check is `npm run test:creator-native-submission-staging`, which requires remote staging D1/R2 and Wrangler configuration unavailable to this isolated run. Separate `npm run test:storefront-visual` and `npm run test:owner-intake-browser` checks both passed. Results and environment are recorded in `docs/LAUNCH-VERIFICATION-RESULT.json` (tested revision `8931f6018f8ca800481488dac9cd708c1047dde9`, dirty tree).
