# TRG Post-Reconciliation Audit Report — What Survived the Fire

**Audit date:** 2026-11-23
**Scope:** Current canonical `main`, `development`, live production, Pages configuration, checked-in tests, and read-only schema/configuration evidence.
**Production state:** CLOSED. This audit made no application, database, deployment, or configuration changes.

## Evidence and limits

- Local and remote refs were checked directly. `main` and `origin/main` are `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`; `development` and `origin/development` are `e2893eacd29acfb43d945d0627df1f2b52858dfa`. The supplied `1f167a76dc0e499889b9075b2e02f3c5a424b3ba` SHA is the parent checkpoint; `e2893eacd29acfb43d945d0627df1f2b52858dfa` adds the post-reconciliation audit documentation. Development descends from `main` and differs by 75 paths (+8,004/−320).
- The canonical worktree was **not clean** at audit start: 24 tracked modifications and 3 untracked files from the existing Phase 1 work. They were left untouched. Current working-tree test results below include those uncommitted changes and are not proof that the committed `development` SHA contains them.
- Cloudflare Pages metadata identifies production's canonical deployment as `ced34184-fd94-44bc-a9c8-53861774cede`, successful, `dirty=false`, on `main` at `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`. Production binds D1 `TRG_ORDERS` (`7e2cd675-a6f1-4fac-bbc9-03485a806c26`) and R2 `TRG_PRODUCTS` (`trg-products`). Secret values were not read or recorded.
- The same production Pages project has a separate successful Preview deployment `87ad5eb9-88cb-4f65-a8b7-87f3388e837e` for `development@e2893eacd29acfb43d945d0627df1f2b52858dfa`; that Preview environment has no D1 or R2 binding. It is not the canonical Acceptance target. The isolated Acceptance project's latest successful Preview is still `6c0c4787-419d-458d-a8c0-25c961f9df8c` from older SHA `a4b8292e281f3795ed365d8cffc9810bdc6da81f`.
- Live checks were unauthenticated GETs plus one safe click on the public Login/Signup control. The click opened the login dialog in place and left the URL at `/`; no credentials were entered and no login, registration, checkout, email, or state-changing request was made.
- Read-only D1 `sqlite_master` and migration-ledger queries were run against production, staging, and Acceptance. Cloudflare reported `rows_written=0` and `changed_db=false` for the ledger queries. No migration or database write was run.
- Focused regressions were run against the current worktree, not a clean worktree at `development@e2893e…`; the full `npm test` suite was not run. Exact passes and the one failure are listed below.

## A. Executive state

TRG is a real, deployed storefront with a public Guest experience, a working in-place Login/Signup popup, native email/password authentication, protected Customer routing, six shared Member Profile routes, a D1-backed catalog API, and cart/order/payment code. Its current live commercial state is **not an open shop**: the store kill switch is `CLOSED`, the Open Rules Library shelf says it will be populated when stocked, all 12 catalog records are preview-only/unavailable, every live checkout mode is disabled, and production has no Stripe API/webhook secrets. The approved login popup is present and opens on the live homepage; this audit did not submit credentials or verify a live account journey.

The repository now has a clear source relationship: `main` is live production; `development` is next. Development contains approved Dashboard/pipeline work plus substantial future marketplace, finance, Creator-capacity, and migration work. Some of that work is incomplete and must not be promoted as one undifferentiated release. The canonical Creator Dashboard route also differs between the current development architecture and live production.

## B. Live production

### Confirmed live behavior

- `https://tobaccoroadgames.com/` and `/guest/` return the Guest Landing Page. Clicking Login/Signup opens the compact login dialog without navigating away; the email, password, Remember Me, Forgot Password, Login, and Sign Up controls are visible. No credentials were entered. This live observation does not reproduce the reported popup failure.
- `/customer` without a session returns `302` to `/guest/`. Native email/password registration/login code creates active accounts and does not require a verified-email state for normal account access; `test-account-auth.js` passes. No live account was created or used, so production credential acceptance and a complete live session journey were not re-tested here.
- `/api/store/status` reports `CLOSED`; `ownerBypass=false` for a public request. This is the operative store gate.
- The six temporary Profile entry routes all return `200` and render the shared “Member Profile” surface: `/customer-profile/`, `/creator/`, `/founding-25-profile/`, `/premium-creator-profile/`, `/admin-profile/`, and `/owner-profile/`. The accepted cabinet and tier badge implementation is present. Route rendering is verified; this does not prove every authenticated identity/visibility rule in live accounts.
- `/store/`, `/store/catalog/`, `/store/cart/`, and `/store/open-rules-library/` return `200`. The Open Rules Library route renders its shelf furniture, but its live copy says the public rules shelf will be populated when stocked; it has no listed titles. Homepage merchandising shelves contain preview/demo links, not sellable catalog inventory.
- Production deployment metadata proves a clean build from the exact `main` SHA. Production Pages uses `npm run build:pages`, D1 `TRG_ORDERS`, and R2 `TRG_PRODUCTS`. Production reports `PAYMENT_PIPELINE_STAGE=production`, `PUBLIC_SITE_ORIGIN=https://tobaccoroadgames.com`, all three live/guest checkout modes disabled, and `RESEND_DELIVERY_ENABLED=false`. Production Pages has no `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, or `RESEND_REPLY_TO` entry. Only environment/secret names and non-secret values were inspected; secret values were not exposed.
- `/owner/*` is gated through Cloudflare Access. `/office/` redirects to the separate Access-protected staging Office hostname; it is internal tooling, not the public storefront.

### Production route findings

- `/creator-dashboard/` redirects to `/temp-creator/`; `/temp-creator/` serves the Creator Dashboard. This is opposite the accepted canonical route in current `development` (`/creator-dashboard/`, with `/temp-creator/` redirecting there). Production is therefore not route-aligned with the accepted Dashboard architecture.
- `/account.html` redirects to `/account`; `/account` loads. The previously rejected large account-page presentation must not be restored. The current functional account surface includes account/profile and library tools, but it is not the complete private Dashboard specified by the architecture.
- `/forum/` returns `200`. `account.html` contains a Forum profile panel which `assets/js/account.js` reveals for authenticated accounts. Forum is recorded as deferred/excluded from the Customer experience, so this is an exposure mismatch even though Forum is not part of the main storefront navigation.
- `/forgot-password/` returns `404`; password recovery is embedded in `/account`. The recovery flow depends on outbound email, while production has `RESEND_DELIVERY_ENABLED=false` and no configured Resend delivery credentials. This does not block native registration/login, but recovery is not production-ready.
- `/store/checkout/` returns `404` as a direct static route. Checkout is API-driven; this response alone is not evidence that the API flow works or fails.
- Five `/guest/preview-products/.../` demonstration pages remain reachable in production. Their content labels them as previews rather than purchasable catalog listings. They are not substitutes for stocked product records.
- `GET /api/catalog` returned 12 products; all 12 have `status=preview-only`, `buyMode=preview-only`, and `purchaseAvailability=unavailable`.

## C. Development-only work

Compared with production `main`, committed `development@e2893eacd29acfb43d945d0627df1f2b52858dfa` adds 75 paths, including:

- The generated `/creator-dashboard/` page, shared Dashboard template, Dashboard stylesheet compatibility import, and route correction.
- The hardened release pipeline, environment map, approval/attestation/rollback checks, and focused pipeline regressions.
- Marketplace policy and payment/order handling, Creator accounting/fee reconciliation, Founder-25 administration, and Creator capacity/privilege work.
- Migrations 073–079 and focused tests for those features. The migrations are not all applied; code presence does not authorize their activation.
- Additional account/Profile and Pages packaging regressions. The six Profile furniture/route assets themselves are already present on `main`; the approved Profile foundation was not rebuilt during reconciliation.

At committed `development@e2893e…`, the Owner finance handler has no per-handler session/role check before reading finance data. The current worktree contains an uncommitted `authorizeOwnerFinanceRequest` guard plus a dedicated test; that test passes. The older `test-finance-integrity-owner-ledger.js` still fails because it looks for a literal `verifySessionToken` in the handler rather than exercising the helper. The committed endpoint remains a security gap until the guard is reviewed, committed, and verified. No finance API request was made.

The latest successful Pages Preview is `87ad5eb9-88cb-4f65-a8b7-87f3388e837e`, created for the `development` branch at `e2893e…` on the separate `tobacco-road-games` Pages project. It has no D1/R2 binding and is not an Acceptance approval. The canonical isolated Acceptance target remains `tobacco-road-games-acceptance`; its latest clean successful Preview `6c0c4787-419d-458d-a8c0-25c961f9df8c` is from older SHA `a4b8292e281f3795ed365d8cffc9810bdc6da81f`, not current development.

## D. Launch-critical gaps

### Technical blockers

1. **No sellable inventory:** live D1 has 12 preview-only/unavailable products. The repository product input is empty (see J). A customer-facing paid or free shop needs approved, published products and their real assets.
2. **Paid checkout is disabled:** all production checkout modes are disabled and Stripe secrets are not configured. Production store state remains CLOSED. No live payment-to-entitlement/download journey was exercised.
3. **Commerce identity policy is approved but the committed implementation is inconsistent:** Owner has settled that `email_verified=0` must not block an authenticated Customer purchase or entitlement/library access. At `main@1b1a8a7` and committed `development@e2893e…`, `transaction-policy.mjs`, `account-library.mjs`, and `native-entitlements-d1.mjs` still impose that gate. The existing uncommitted worktree changes remove it and the focused local commerce tests pass, but the change is not in either canonical ref or production. No additional Owner policy decision is needed.
4. **Forum exposure contradicts settled policy:** `/forum/` returns `200`, and production `/account` includes the Forum profile panel that the account script exposes to authenticated members. The current worktree removes the Account panel but preserves Forum backend/routes; that change is uncommitted. Keep Forum out of the Customer experience as already directed.
5. **Current production account path lacks a live end-to-end smoke:** source and local tests support native registration/login, but this audit did not create production accounts or test sessions. Run a controlled, approved launch smoke with cleanup before opening.
6. **Owner finance API authorization is incomplete in committed `development`:** the current dirty worktree adds an active Admin/Owner session check and same-origin/CSRF checks on POST, and its dedicated test passes. This guard is not in the committed ref or production.
7. **Acceptance schema is incomplete for current account flow:** isolated Acceptance D1 lacks `customer_registration_states` and `creator_commission_category_assignments`. Do not test account registration against it until a reviewed isolated setup/migration is available. Production and staging already contain the focused account/Profile schema; no migration is needed on production for this audit.

### Product/content blockers

- No stocked initial catalog is available for purchase; the five live demo pages do not satisfy this.
- Initial product prices/availability and the intended first Creator cohort must be represented in the production catalog before opening.
- Creator compensation, publication capacity, and tier allocation implementation in development depends on migrations not applied to production. Do not promise those limits/allocations until the relevant release and schema are verified.

### Owner decisions genuinely required

- Approve the opening inventory, prices, and initial Creator cohort. If Premium Creator is included at opening, set its monthly/annual prices and define treatment of excess catalog titles after subscription expiration; those are explicitly unresolved in `MEMBER-ACCOUNT-ARCHITECTURE.md`.
- Authorize changing the store from CLOSED only after the technical and content gates pass. The current CLOSED state is intentional; this audit does not authorize reopening it.

Detailed Profile visibility rules and Customer poster-frame behavior remain unresolved, but neither is evidenced as a blocker for a narrowly scoped Customer storefront opening unless those surfaces are included in the launch promise.

## E. Later / non-launch-critical

- Persistent library display selections and physical-capacity enforcement. Current shelves are intentionally empty when there is no established selection; do not fill them from arbitrary purchases.
- Premium Creator prices/expiration behavior if Premium Creator is not part of the initial cohort.
- Migration 078’s supplemental auth-rate cleanup index; baseline rate limiting exists, but the additional cleanup work is not active.
- Email-dependent password recovery can be completed after normal account access is stable; it is not a prerequisite to the approved native login path, but should be provided before self-service account recovery is promised.
- Deeper ad-event analytics/fraud controls; current code records/deduplicates events but is not a complete abuse-resistant analytics system.
- Detailed Profile visibility and poster-frame policy, subject to the scope of the public launch.

## F. Shelved

- Migration 073 Open Rules upper/lower shelf split. Production retains the current shared upper shelf; staging contains its own split configuration. Do not treat the staging-only configuration as production behavior.
- Saved-card/consent work and migration 079. The full migration collides with schema already created by the focused account/Profile migration and requires a future forward-only migration if resumed.
- Creator catalog-cover rotation by default. The script is default-off and no owner-approved opt-in exists.
- Stripe Express/CSV sandbox and SMTP transport prototype. These do not provide active production payment/email paths.
- Forum product work is deferred; its current reachability is separately flagged above for correction before Customer opening.
- Ask Gary/AI: no runtime feature/API or configured AI credential was found in current functions/assets; `ai-policy.html` is not an AI feature. No active launch plan was evidenced, so it is treated as shelved/absent rather than implemented.
- Historical staging-only migration 055 Profile customization/shelf-selection tables. Keep as inert historical residue; current application source does not use them.

## G. Dead / rejected / superseded

- Google authentication.
- Email verification as a requirement for ordinary registration, login, or Customer access.
- The rejected large `/account.html` redesign/presentation; preserve the current functional account route without reviving that design.
- Superseded Guest/Customer navigation variants, bare `openRules` binding, and staging logout redirect to the production domain.
- Old `trg-member-tier-test-20261120` project as an active Preview target. Historical records may retain its name.

## H. Route inventory

| Route | Current production result / purpose | Current development architecture | Status and exposure decision |
| --- | --- | --- | --- |
| `/`, `/guest/` | Guest storefront; both 200 | Guest is canonical source | Keep public; Login/Signup popup is the approved entry. |
| `/customer` | 302 to `/guest/` without session | Authenticated Customer storefront | Keep protected. Live guard confirmed; no authenticated live session was tested. |
| `/account.html`, `/account` | 308 to `/account`; Account page 200 | Account management surface | Keep existing functional route; do not restore rejected presentation. |
| `/customer-profile/`, `/creator/`, `/founding-25-profile/`, `/premium-creator-profile/`, `/admin-profile/`, `/owner-profile/` | All 200 shared Profile shell | Shared `renderMemberProfilePage()` | Retain all six temporary entry points until dynamic replacement is accepted. |
| `/creator-dashboard/` | 302 to `/temp-creator/` | Canonical Dashboard route/page in development | Production mismatch; correct only through separately tested release. |
| `/temp-creator/` | 200 Creator Dashboard | Legacy redirect to `/creator-dashboard/` | Keep as temporary compatibility path until production route correction is verified. |
| `/store/`, `/store/catalog/`, `/store/cart/` | 200 | Current shop surfaces | Keep; remain subject to CLOSED store and unavailable products. |
| `/store/checkout/` | 404 as static GET | Checkout is API-driven | Do not advertise this as a standalone page; verify API flow before sale launch. |
| `/store/open-rules-library/` | 200; shelf copy says it will be stocked later, with no titles | Shared catalog/shelf source | Keep the route and furniture; stocking is incomplete, and the split-shelf variant is shelved. |
| `/guest/preview-products/<five slugs>/` | 200 prototype pages | Not actual purchasable D1 catalog listings | Treat as demos; do not use as launch inventory. |
| `/forum/` | 200 Forum page | Forum is deferred/excluded from Customer experience | Shelved route currently exposed; remove from Customer experience before opening. |
| `/forgot-password/` | 404 | Reset UI is embedded in `/account` | Do not link to this nonexistent standalone route. |
| `/owner/*` | Cloudflare Access-gated | Owner tools | Keep restricted; test every API handler’s own authorization before release. |
| `/office/` | 307 to `office-staging.tobaccoroadgames.com/office/` | Internal Access-protected Office tooling | Internal route only; not part of customer navigation. |

## I. Data and migration state

Read-only D1 evidence from this audit and the migration history in `PROJECT-STATE.md`:

- Production D1 `7e2cd675-a6f1-4fac-bbc9-03485a806c26` records numbered migrations through 072. The focused `account-profile-072` schema is present, including `customer_registration_states` and `creator_commission_category_assignments`.
- Staging D1 `d92594e8-a45c-4f84-8f48-7c3aeba17f29` records through migration 073 and has the focused schema. Its historical 055 tables are staging-only and unused by current application code.
- Acceptance D1 `2fff6e72-4e41-47e7-b497-992dadcab3d6` records through migration 069 and is isolated from production/staging, but lacks both focused account/Profile tables. Its latest successful Preview is from SHA `a4b8292e281f3795ed365d8cffc9810bdc6da81f`; current `development@e2893e…` has not been deployed to that Acceptance project.
- Migrations 074–078 are unapplied. Migration 075 overlaps a table/index supplied by the focused migration and cannot be applied unchanged. Migration 079 is unapplied and overlaps `customer_registration_states`; its saved-card/consent work is shelved. Any revival needs a collision-safe forward migration.
- No migration was run and no D1 data was changed during this audit; the read queries reported zero rows written.

## J. Generator and catalog pipeline

`data/products.json` is exactly `[]` (3 bytes). `scripts/build-runtime-catalog.mjs` reads that file to generate `shared/runtime-catalog.mjs`; `scripts/build-store.js` also treats it as the product source and generates homepage/product outputs. The live catalog instead comes from D1 through `functions/api/catalog.js` and `functions/_lib/public-product-catalog.mjs`; the live API currently returns 12 preview-only products.

The full generator is **partially obsolete and unsafe to run against the canonical checkout as-is**. `scripts/build-store.js` removes and recreates `store/`, `authors/`, `creators/`, and `guest/` before rebuilding from the empty repository input. A previous scratch/copy execution produced no active or historical products and removed five checked-in Guest preview pages; those changes were restored. Do not run the full generator to investigate or to prepare a release. `npm run build:pages` is a separate allowlisted packaging step and passed its focused checks; that does not make the full product generator safe or populate the D1 catalog.

**Recommendation:** constrain the generator to a disposable output directory or make it fail closed on empty input, then define an approved product-content source/build workflow that does not erase hand-maintained pages. Until that is verified, release from committed reviewed artifacts and manage live products through the approved D1 publication path.

## K. Launch-readiness scorecard

| Subsystem | Status | Evidence / exact gap |
| --- | --- | --- |
| Public Guest presentation and login popup | READY WITH KNOWN LIMITATION | Live Guest routes render; no real production login was performed in this audit. |
| Native registration/login/session/logout | READY WITH KNOWN LIMITATION | Native auth tests pass; no verification gate/provider required. Production live session smoke remains outstanding. |
| Customer route guard | READY | Unauthenticated `/customer` returns 302 to `/guest/`. |
| Account recovery | INCOMPLETE | Email-dependent reset exists under `/account`; provider is not configured in production; standalone forgot-password route is 404. |
| Six Profiles/shared cabinet | READY WITH KNOWN LIMITATION | Six routes return 200; shared render/badge regression checks pass; visibility/persistent shelves are unfinished. |
| Creator Dashboard | INCOMPLETE | Development has canonical route; production redirects canonical path to `/temp-creator/`. |
| Public catalog/content | BLOCKED | 12 D1 records all preview-only/unavailable; repository generator input is empty. |
| Cart/quote/checkout | BLOCKED | Checkout modes disabled; no live checkout configuration or end-to-end purchase verification. |
| Stripe/paid fulfillment | INCOMPLETE | Code exists; entitlement regression fails; delivery/library fixtures fail schema validation; no live purchase smoke. |
| PWYW/free acquisition | INCOMPLETE | Implementation exists, but grouped test fails at Owner-intake fixture lacking a rendered Guest page. |
| Orders/refund/repair | INCOMPLETE | APIs and idempotency/recovery code exist; production commerce is closed; no live transaction test. |
| Creator onboarding/publication | INCOMPLETE | APIs and tests exist; launch-ready end-to-end publication and initial cohort not verified. |
| Admin/Owner privileges | INCOMPLETE | Owner Access gate exists; development finance endpoint lacks explicit handler auth and its test fails. |
| Forum/customer exposure | BLOCKED | Deferred feature is directly reachable and its Account panel is shown to authenticated users. |
| Creator finances/capacity/Founding-25 allocations | NOT REQUIRED FOR CUSTOMER-ONLY OPENING / INCOMPLETE | Development-only code and unapplied migrations; do not promise these privileges until released. |
| Release pipeline and isolation | READY WITH KNOWN LIMITATION | `release:verify` passes; acceptance is isolated, but current development is not deployed there and Acceptance lacks focused account schema. |
| Full-site generator | INCOMPLETE / OPERATIONAL HAZARD | Empty JSON input plus destructive output cleanup; safe Pages packaging is a different command. |
| Store state | BLOCKED BY OWNER GATE | Public endpoint says CLOSED; do not reopen without explicit launch authorization. |

### Focused test evidence

- `npm run release:verify` passed all 10 focused checks: pipeline, progressive navigation, Pages output, environment isolation, storefront visual, Creator PDF intake, Profile access, Profile library, six Profile inheritance, and shared cabinet.
- Focused account-auth, account-native-UI, product-catalog-D1, product-publication, native D1 Stripe, cent-conservation, and Forum profile/category/topic/reply/moderation tests passed in the audit run. These local tests do not prove a live production transaction.
- `npm test` stopped in pretest at the stale Creator Profile expectation for `id="creator-edit-form"`; approved architecture puts editing on the separate Dashboard, not the Profile. This is a stale test expectation, not evidence the deployed Profile is broken.
- `npm run test:native-pwyw` failed because its temporary Owner-intake fixture omits the rendered Guest page required by Profile generation.
- `test-native-d1-entitlements.js` failed with `native_entitlement_snapshot_invalid`.
- `test-native-d1-delivery.js` and `test-native-d1-library.js` fail fixture validation because fixtures omit `creatorFeeBasisPoints`; behavior remains unproven by those tests.
- `npm run test:finance-integrity` failed because its expected `verifySessionToken` guard is absent from `functions/owner/api/finance.js`; treat the endpoint as a security blocker, not as a stale assertion.
- Creator-native review sandbox has a stale Profile-form assertion for the same Dashboard/Profile boundary; separately, the first two submission sandboxes passed.
- No broad test suite is reported as passing.

## L. Recommended next-work order

1. **Close confirmed policy/security exposure first:** require server-side authorization in the development Owner finance API, pass its focused test, and remove the deferred Forum surface from Customer-facing Account/navigation/route exposure under the already-settled policy. Correct the production Dashboard route in a separately verified release.
2. **Resolve commerce identity policy:** decide whether email verification gates purchases/entitlements. Keep the accepted rule that it does not gate registration/login. Then align the purchase/library code and tests with that decision; do not configure a provider by assumption.
3. **Stock the launch catalog:** approve the first Creator cohort, products, assets, prices, sale modes, and publication state. Do not run the full generator until its empty-input/destructive behavior is constrained.
4. **Prove the customer transaction path on isolated Acceptance/Staging:** supply required isolated schema, then verify product visibility, cart quote, Stripe/PWYW/free acquisition as intended, webhook idempotency, order records, entitlements, download delivery, and recovery. Resolve the failing entitlement/test-fixture cases before any promotion.
5. **Prepare a single exact-SHA release and launch gate:** deploy the reviewed artifact through acceptance and staging, run live registration/login/logout and transaction smoke checks with cleanup, compare production bindings, and leave the production kill switch CLOSED until the Owner explicitly authorizes opening.

## Inventory by required category

Each row below is one meaningful work unit. Counts reflect these rows, not source-file counts.

| # | Work unit | Category | State/evidence and remaining work |
| ---: | --- | --- | --- |
| 1 | Public navigation and Guest login popup | **1 Live and working** | A live click opens the popup without navigating; no credentials were submitted, so login completion was not tested. |
| 2 | Guest storefront/cabinet presentation | **1 Live and working** | Live `/` and `/guest/` render. Frozen approved furniture is protected by visual tests. |
| 3 | Authenticated Customer navigation, logout, Profile link | **1 Live and working** | Approved code is in `main`; Customer route protection is live. Authenticated production interaction was not repeated. |
| 4 | Store kill switch | **1 Live and working** | `/api/store/status` reports CLOSED and no public bypass. |
| 5 | Six shared Member Profile routes and tier badges | **1 Live and working** | All six routes return 200; shared-renderer and visual tests pass. |
| 6 | Native email/password auth without verification gate | **1 Live and working** | Auth implementation and focused tests pass; uses email as identifier, no provider needed for registration/login. |
| 7 | Open Rules Library shelf | **3 Partially built / incomplete** | Route and furniture render, but the live shelf says it will be populated when stocked and has no titles. |
| 8 | Production Pages build/source identity | **1 Live and working** | Clean successful deployment is tied to exact `main` SHA; automatic build is `npm run build:pages`. |
| 9 | Owner route access boundary | **1 Live and working** | `/owner/*` is behind Cloudflare Access. This does not replace per-API authorization. |
| 10 | Internal Office route boundary | **1 Live and working** | `/office/` redirects to the Access-protected staging Office hostname; not customer-facing. |
| 11 | D1 public product catalog | **3 Partially built / incomplete** | API returns 12 rows but every row is preview-only and unavailable. |
| 12 | Store/catalog browse pages | **3 Partially built / incomplete** | Routes render, but live catalog has no purchasable items. |
| 13 | Five Guest preview-product pages | **6 Shelved** | Public prototypes remain reachable, explicitly not purchasable; they are not launch stock. |
| 14 | Cart and price quote | **3 Partially built / incomplete** | Code/tests exist; quote/checkout cannot complete while store and modes are closed. |
| 15 | Stripe-hosted checkout | **3 Partially built / incomplete** | Code path exists; production modes disabled and no live checkout test. |
| 16 | Production Stripe configuration | **4 Launch-critical and still missing** | No Stripe API/webhook secret configured; all checkout modes disabled. |
| 17 | PWYW/free acquisition | **3 Partially built / incomplete** | Code exists and the focused free-acquisition test passes in the current worktree; production modes are disabled and no live transaction was attempted. |
| 18 | Native order creation, idempotency, webhook | **3 Partially built / incomplete** | Implementation and focused tests exist; no live transaction was attempted. |
| 19 | Paid entitlements and downloads | **3 Partially built / incomplete** | Focused entitlement, delivery, and library tests pass in the current worktree; purchase modes are disabled and no live purchase/download was attempted. |
| 20 | Guest purchase/claim path | **6 Shelved** | Guest checkout/claim flags are disabled in production. |
| 21 | Account page/settings/library UI | **3 Partially built / incomplete** | Functional `/account` exists; rejected redesign stays excluded; it is not the full private Dashboard promised by architecture. |
| 22 | Email-dependent password recovery | **3 Partially built / incomplete** | UI/API exist under Account but production delivery is disabled/unconfigured; standalone `/forgot-password/` is 404. |
| 23 | Commerce email-verification policy enforcement | **4 Launch-critical and still missing** | Approved policy says unverified authenticated Customers may purchase and use entitlements; `main` and committed `development` still gate these paths. Uncommitted working changes remove the gate and focused tests pass; no Owner decision remains. |
| 24 | Profile viewer visibility rules | **3 Partially built / incomplete** | Identity/class comes from account APIs; detailed visibility policy and complete live tier behavior remain unfinished. |
| 25 | Persistent Profile/Storefront shelf selections | **5 Later / non-launch-critical** | No current selection path; shelves correctly remain empty instead of guessing. |
| 26 | Creator onboarding/upgrade | **3 Partially built / incomplete** | Registration/API paths exist; paid upgrades and full production path are not launch-verified. |
| 27 | Canonical Creator Dashboard route/page | **2 Built in development, not live** | Development serves `/creator-dashboard/`; production redirects it to `/temp-creator/`. |
| 28 | Creator Dashboard PDF draft validation/save | **2 Built in development, not live** | Development template/runtime and focused test target canonical Dashboard; route correction is not live. |
| 29 | Creator product submission and Owner review | **3 Partially built / incomplete** | APIs and sandbox tests exist; full production cohort/publication cycle is unverified. |
| 30 | Default Creator catalog-cover rotation | **6 Shelved** | Script is guarded default-off; no approved opt-in exists. |
| 31 | Founding-25 administration/allocation | **2 Built in development, not live** | Code and migration 077 work are in development; schema is unapplied in production. |
| 32 | Admin publication/account operations | **3 Partially built / incomplete** | Privileged code exists; complete live role/API matrix was not verified. |
| 33 | Owner finance and account tools | **3 Partially built / incomplete** | Owner surfaces exist; committed finance API does not authenticate/authorize at the handler before reading financial data. No finance API call was made. |
| 34 | Development Owner finance API authorization | **3 Partially built / incomplete** | The committed ref lacks a per-handler guard. The uncommitted worktree adds `authorizeOwnerFinanceRequest` and a passing semantic test; the older integrity test still expects the literal `verifySessionToken`. Resolve before any release of finance tools. |
| 35 | Pricing/marketplace policy snapshots | **2 Built in development, not live** | Migration 074 and policy code are development-only and unapplied. |
| 36 | Homepage editing | **3 Partially built / incomplete** | Owner editor/D1 code and tests exist; no live Owner edit was performed in this audit. |
| 37 | Order administration/refund/recovery | **3 Partially built / incomplete** | Code exists; production commerce is closed and no live transaction was exercised. |
| 38 | Creator earnings/commission/Stripe fee reconciliation | **2 Built in development, not live** | Development code/migrations 074–076/related tests exist; production schema and release are not prepared. |
| 39 | Creator capacity/Founding-25 limits | **2 Built in development, not live** | Development code and migration 077 exist; not enforced by production schema. |
| 40 | D1-managed Open Rules shelf split | **6 Shelved** | Migration 073 is staging-only; production remains on the shared current shelf configuration. |
| 41 | Forum feature | **6 Shelved** | Deferred by policy; production `/forum/` still returns 200 and the backend remains present. |
| 42 | Forum exposure inside Customer Account | **4 Launch-critical and still missing** | Production and committed `development` contain a Forum profile panel revealed to authenticated Account users. The uncommitted worktree removes the panel but preserves the Forum backend/routes. |
| 43 | Ask Gary/AI | **6 Shelved** | No runtime UI/API or configured AI credential found; `ai-policy.html` alone is not an implemented feature. |
| 44 | Creator CSV/business exports | **3 Partially built / incomplete** | Business-report code exists in development; export authorization and release readiness are not demonstrated. |
| 45 | Ad event logging | **3 Partially built / incomplete** | Impression/click endpoint deduplicates events; no complete abuse-resistant analytics protection was established. |
| 46 | Resend/SMTP account-mail provider prototypes | **6 Shelved** | Normal registration/login do not use mail; recovery remains email-dependent and production delivery is off. |
| 47 | Google authentication | **7 Dead / rejected / superseded** | Explicitly excluded from TRG authentication. |
| 48 | Verification-gated ordinary registration/login | **7 Dead / rejected / superseded** | Explicitly removed; do not restore the gate. |
| 49 | Rejected large Account-page redesign | **7 Dead / rejected / superseded** | Do not restore that presentation; retain the current functional Account surface. |
| 50 | Old Guest/Customer navigation, bare `openRules`, production logout target from staging | **7 Dead / rejected / superseded** | Superseded implementation variants; current accepted navigation uses the shared Open Rules export and correct environment origin. |
| 51 | Exact-SHA release pipeline and approval record | **2 Built in development, not live** | `release:verify` passes; pipeline code and release environment map are development work. |
| 52 | Isolated Acceptance Preview | **3 Partially built / incomplete** | Isolated project bindings are correct; latest successful Preview is old SHA and its D1 lacks focused account/Profile tables. A separate `development` Pages Preview has no D1/R2 bindings and is not acceptance evidence. |
| 53 | Staging/production/acceptance schema alignment | **3 Partially built / incomplete** | Production/staging have focused schema; Acceptance lacks two required tables; numbered migrations differ by environment. |
| 54 | Focused migration 072 | **1 Live and working** | Additive account/Profile schema is present on production and staging; no migration was run in this audit. |
| 55 | Migrations 074–078 | **5 Later / non-launch-critical** | Unapplied future finance, allocation, and rate-cleanup changes; require later collision-safe reviewed release. |
| 56 | Migration 073 | **6 Shelved** | Open Rules shelf split is not active in production. |
| 57 | Migration 079 saved-card/consent work | **6 Shelved** | Unapplied; collides with focused registration-state schema if run unchanged. |
| 58 | Additional R4 rate-limit cleanup index | **5 Later / non-launch-critical** | Basic auth throttling exists; supplemental migration 078 is not applied. |
| 59 | Historical staging migration 055 tables | **6 Shelved** | Preserved only on historical `origin/staging`; current source does not use them. |
| 60 | Full storefront generator | **3 Partially built / incomplete** | Empty JSON input plus recursive cleanup can erase generated directories/pages; do not run on canonical checkout. |
| 61 | Store opening and live launch sign-off | **4 Launch-critical and still missing** | Production is intentionally CLOSED. Reopening requires completed technical/content gates and explicit Owner authorization. |
| 62 | Approved sellable opening catalog | **4 Launch-critical and still missing** | No record is purchasable; approve and publish the initial product set, assets, prices, and Creator cohort. |
| 63 | Production end-to-end launch smoke | **4 Launch-critical and still missing** | This audit did not create accounts or perform a live purchase; run approved controlled registration/session/purchase/delivery checks and cleanup before opening. |

### Category counts

| Category | Count |
| --- | ---: |
| 1. Live and working | 10 |
| 2. Built in development, not live | 7 |
| 3. Partially built / incomplete | 23 |
| 4. Launch-critical and still missing | 6 |
| 5. Later / non-launch-critical | 3 |
| 6. Shelved | 10 |
| 7. Dead / rejected / superseded | 4 |
| **Total** | **63** |
