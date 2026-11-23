# TRG project state

Status verified 2026-11-23 after Phase 3B. `main` is the live production line; `development` is the accepted next-development line reconstructed from `main` plus approved continuing and deferred work.

## Git and production truth

- Production source and `main`: `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`.
- Active production Pages deployment: `ced34184-fd94-44bc-a9c8-53861774cede`; production is marked clean and the storefront remains **CLOSED**.
- Production bindings: D1 `TRG_ORDERS` → `7e2cd675-a6f1-4fac-bbc9-03485a806c26`; R2 `TRG_PRODUCTS` → `trg-products`.
- Canonical `development` contains the accepted Phase 3A reconstruction, based on `main`, followed by this documentation-only Phase 3B closeout. Phase 3B does not change application behavior, deploy, or modify production/staging.
- Old pre-reconciliation `development` remains recoverable at `e796fd8fd8b4aad8eeb61f284eec0d029b2552a6` through remote preservation tag `preserve/pre-reconcile-2026-11-23-development-e796fd8`.
- `reconcile/development-2026-11-23` remains preserved at accepted Phase 3A commit `8288d954cee35c323a577f05f744d94f09801fe8`; it descends from `main` and remains a historical reconstruction reference.
- Preservation refs for pre-reconciliation `main` and production remain the rollback/recovery anchors recorded during Phase 1.

## Approved current behavior

- Main retains native email/password authentication without a verification gate or required mail provider; Customer access requires a valid session.
- The accepted Guest login popup, authenticated Customer navigation, Profile link, Logout flow, and logout destination are in the production baseline.
- The six Profile entry points and accepted shared Profile/cabinet/badge implementation remain present. Creator Dashboard is separate at `/creator-dashboard/`.
- Store is **CLOSED**. No Phase 3A work changes that state.

## Deferred and shelved boundaries

- Category 2 financial/commission accounting, Creator capacity/Founding-25 allocation logic, email-dependent recovery work, and R4 authentication throttling remain future/deferred. Their code/tests/migrations are development material only; no unapplied migrations were run.
- Category 3 D1 Open Rules shelf split, saved-card/payment-method UI, Creator cover rotation as default behavior, Stripe Express/CSV sandbox, and SMTP transport remain shelved and are not activated by this candidate.
- Category 4 Google authentication, verification-gated ordinary login, email-provider dependency for ordinary authentication, rejected account-page presentation, superseded navigation variants, bare `openRules` bindings, and staging logout-to-production behavior remain excluded.
- Forum remains deferred and excluded from Customer experience.

## Migration record (read-only verification)

Migration source files 073–079 are retained for historical continuity and later formal reconciliation. The branch does not execute them.

| Migration | Source/environment state | Active feature state in this reconstruction |
| --- | --- | --- |
| 073 Native Open Rules shelf split | Source retained; applied only to staging D1 `d92594e8-a45c-4f84-8f48-7c3aeba17f29` on 2026-11-12; not applied to production D1 | Shelved; no split implementation imported |
| 074–076 financial snapshots, fee reconciliation, and classification | Source retained; not applied to staging or production | Future/deferred |
| 077 Creator capacity privileges | Source retained; not applied to staging or production | Future/deferred |
| 078 auth rate-limit cleanup index | Source retained; not applied to staging or production | Future/deferred |
| 079 signup-state and saved-card schema | Source retained; not applied to staging or production | Saved-card flow shelved; pending-registration behavior is superseded for normal auth |

The separate focused `account-profile-072` migration is recorded in `ops/releases/records/auth-no-email-2026-11-22.json`; its historical staging/production schema verification is not a Phase 3A migration action.

## Build limitation observed during Phase 3A

`node scripts/build-store.js` completed but reported zero active products and zero historical records from the checked-in build inputs. It consequently rewrote several generated catalog/storefront pages and removed five checked-in Guest preview-product pages. Those unrelated generated changes were restored and excluded. `npm run build:pages` successfully packaged the committed page set (252 allowlisted files), including the generated canonical Creator Dashboard. The immutable release pipeline builds from the exact committed static artifact; full product-page regeneration from the repository alone remains unfinished and must not be treated as verified by the Pages packaging result.
