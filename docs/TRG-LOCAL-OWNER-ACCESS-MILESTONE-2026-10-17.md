# Tobacco Road Games Local Owner Access Milestone

Verification date: October 17, 2026
Originally scheduled: October 18, 2026
Workspace: `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`
Branch: `staging`
Baseline commit: `d1a5e916baf43bceffea6d4598e56c86dee35ae9`

## Executive result

The local Owner Dashboard milestone is operationally complete for RV's staging workbench.

- The actual Owner Dashboard is available at `http://127.0.0.1:8788/owner/`.
- It requires no username, password, or authenticator when reached through the loopback-only workbench.
- The server listens only on `127.0.0.1`; it is not exposed on a LAN or public interface.
- Owner reads use the isolated staging D1 databases and R2 buckets through Wrangler remote bindings.
- Staging and production both remained `CLOSED` throughout verification.
- Production code, data, authentication, products, payments, and deployment state were not changed.
- Customer and Creator authentication were not changed.

This is not the permanent Owner authentication replacement. That work remains explicitly deferred.

## Local access design

The local exception has multiple independent boundaries:

1. `LOCAL_OWNER_BYPASS` must be explicitly enabled in the local development environment.
2. The request URL hostname must be a loopback host (`127.0.0.1`, `localhost`, or IPv6 loopback).
3. Any forwarded host must also identify loopback.
4. If a Cloudflare connecting-IP header is present, it must identify loopback.
5. Wrangler is started with `--ip 127.0.0.1`, so the process does not listen on a public or LAN interface.

The checked-in launcher, `ops/staging/start-local-owner.ps1`, enforces the canonical workspace and `staging` branch, copies a local-only Wrangler template into place for the life of the process, generates a fresh cryptographically random CSRF secret, and deletes both temporary files when Wrangler exits. The secret is never stored in the tracked template.

The bypass does not remove request-integrity controls. Owner mutations still require:

- same-origin requests;
- an Owner CSRF cookie;
- the matching `x-csrf-token` header; and
- normal route-specific validation.

For non-loopback requests, the local exception is rejected and the existing external Owner security path remains authoritative. The public staging deployment was not changed or redeployed.

## Resource isolation

The running local workbench reported these remote bindings:

| Binding | Isolated staging resource |
| --- | --- |
| `TRG_ORDERS` | D1 `trg-orders-staging` |
| `TRG_OFFICE` | D1 `trg-office-staging` |
| `TRG_PRODUCTS` | R2 `trg-products-staging` |
| `TRG_FORUM_AVATARS` | R2 `trg-forum-avatars-staging` |
| `TRG_OFFICE_ARCHIVE` | R2 `trg-office-archive-staging` |

`PAYMENT_PIPELINE_STAGE` remains `staging`. Local email delivery is disabled. No production binding, Stripe credential, product object, or payment operation was used.

## Dashboard and navigation verification

All major Dashboard destinations loaded with HTTP 200 through the loopback server:

| Owner surface | Result |
| --- | --- |
| Dashboard | PASS |
| Store Status | PASS |
| Product Intake | PASS |
| Listing File Maintenance | PASS |
| Creator Reviews | PASS |
| Launch and Creator Reputation | PASS |
| Discovery Labels | PASS |
| Product Inactivity | PASS |
| Marketplace Finance | PASS |
| Creator Finance | PASS |
| Payout Batches | PASS |
| Homepage Selections | PASS |
| Bric-a-Brac | PASS |
| Pricing Editor | PASS |
| Orders | PASS |
| Author Discussions | PASS |
| Ad Upload | PASS |
| Advertising Operations | PASS |

The Dashboard itself rendered the staging store state as `CLOSED`. RV independently confirmed that he could see the opened Dashboard.

## Read-only administrative data verification

The following authorized GET routes reached the real staging services and returned HTTP 200:

- Store status
- Listing files
- Creator review/publication queue
- Creator reputation
- Discovery labels
- Creator finance and payout readiness
- Marketplace finance ledger
- Author discussions using the configured `rv-sawyer` author slug
- Advertising inventory
- Shelf-curio activity
- Order lookup using a guaranteed non-matching probe

No financial operation, payout, refund, listing change, publication, email, product upload, order mutation, or store-state change was performed.

## Authorization and security verification

| Check | Expected | Result |
| --- | --- | --- |
| Loopback page with local flag | Allowed | PASS |
| Public hostname with local flag | Denied | PASS (`503`) |
| Non-loopback connecting IP | Denied | PASS |
| Non-loopback forwarded host | Denied | PASS |
| Mutation without Origin | Denied | PASS (`403`) |
| Mutation without CSRF token | Denied | PASS (`403`) |
| Authorized mutation with invalid store state | Authentication passes; business validation rejects before write | PASS (`400`) |
| Listener interface | `127.0.0.1` only | PASS |
| Public staging Owner route | Existing protected/login behavior retained | PASS |

The invalid store-state probe used `NOT_A_REAL_STATE`. It proved that authorization and CSRF checks succeeded while route validation rejected the request before any write.

## Store-state confirmation

- Production `/api/store/status`: `CLOSED`, `ownerBypass: false`
- Staging `/api/store/status`: `CLOSED`, `ownerBypass: false`
- Local authorized Owner status: `CLOSED`

Neither store was opened or otherwise modified.

## Tests performed

Passed:

- `node scripts/test-owner-local-access.js`
- `node scripts/test-owner-intake.js`
- `node scripts/test-store-kill-switch.js`
- `node scripts/test-owner-pricing-editor.js`
- `node scripts/test-owner-listing-file-maintenance.js`
- `node scripts/test-finance-integrity-owner-ledger.js`
- `node scripts/test-shelf-curios.js`
- `node scripts/test-preferred-internal-purchase-repairs.js`
- `node scripts/test-preferred-internal-purchase-policy.js`
- `node scripts/test-preferred-internal-purchase-ui.js`
- `node scripts/test-creator-balance-internal-purchases.js`
- `node scripts/test-creator-balance-service-purchases.js`
- `node scripts/test-preferred-recurring-billing.js`
- `node scripts/test-additional-identity-billing.js`
- `node scripts/test-stripe-ad-credit-service-revenue.js`
- `node scripts/test-creator-service-refunds.js`
- `node scripts/test-transaction-payout-policy.js`
- `git diff --check`
- Eighteen-page live loopback load test
- Eleven-route read-only Owner API test, plus the corrected Author Discussions request
- Live loopback, hostname, same-origin, CSRF, and listener checks

Repository-wide gate:

- The Preferred Creator failure at `scripts/test-preferred-internal-purchase-repairs.js:35` was an obsolete fixture. Commit `5a083bd` intentionally cleared the launch delivery catalog, while the test still assumed that `agency` had a global delivery mapping. The test now supplies an explicit server-side PDF fixture mapping.
- A forged customer request containing its own delivery mapping is rejected with HTTP `409`, creates no forged entitlement, and cannot replace the server-authoritative mapping. The valid test purchase receives the exact trusted fixture key, filename, and content type.
- The seven catalog-reset regressions were converted from retired-product assumptions to isolated fixtures without restoring retired products or changing marketplace policy.
- All 69 present `scripts/test-*.js` files pass. This is the requested original 68-test inventory plus the newly added loopback Owner-access security test.
- The complete `npm test` command passes.
- `git diff --check` passes.

## Working-tree review

The worktree is intentionally not clean and nothing has been committed, pushed, or deployed.

Unfinished source work includes:

- the earlier retirement of internal Owner username/password authentication;
- conversion of Owner route authorization to the shared Owner read/mutation guards;
- the new loopback-only local Owner-access module;
- local-access and adjusted Owner security tests;
- deletion of the obsolete password-hash helper in the working tree; and
- a staging-only, loopback-only local Wrangler template and launcher; and
- the Preferred Creator server-authoritative delivery-fixture correction; and
- isolated fixture repairs for the catalog-reset regression tests.

Additional uncommitted items:

- the final launch audit and November 28 punch-list documents remain untracked;
- this milestone document is untracked until RV approves it;
- the three formerly tracked Miniflare cache database files are marked for deletion and `.wrangler/` remains ignored;
- root `wrangler.toml` and `.dev.vars*` are repository-wide ignored;
- the verified launcher removed its temporary root `wrangler.toml` and `.dev.vars.owner-local` after shutdown; and
- no local secret or runtime artifact is present in the proposed commit.

The current working changes require RV's final commit approval. They must not be pushed or deployed as-is.

## Milestone classification

**Operational local Owner milestone: COMPLETE.**

RV has a working local Owner Dashboard connected only to isolated staging resources, with authorization, same-origin, CSRF, and loopback boundaries verified.

**Repository finalization: TESTED AND PREPARED FOR RV APPROVAL, NOT COMMITTED.**

The Owner/local-access change set, Preferred Creator repair, and catalog-reset fixture modernization are reviewed and ready for an approval checkpoint. Generated Wrangler cache files are removed from tracking, temporary configuration is absent, and secret-leak and whitespace checks pass. The individual and repository-wide regression gates are green. Permanent Owner authentication replacement is outside this milestone and has not begun.
