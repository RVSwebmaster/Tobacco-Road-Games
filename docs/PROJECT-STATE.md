# TRG project state

Status updated 2026-11-23 for Phase 6 structural closeout. `main` is the live production line; `development` is the accepted next-development line reconstructed from `main` plus approved continuing and deferred work. Current SHAs are read from Git refs rather than duplicated here. See [the reconciliation closeout record](RECONCILIATION-CLOSEOUT-2026-11-23.md) for preservation anchors, migration dispositions, and final structural verification.

## Git and production truth

- Production source and `main`: `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`.
- Active production Pages deployment: `ced34184-fd94-44bc-a9c8-53861774cede`; production is marked clean and the storefront remains **CLOSED**.
- Production bindings: D1 `TRG_ORDERS` → `7e2cd675-a6f1-4fac-bbc9-03485a806c26`; R2 `TRG_PRODUCTS` → `trg-products`.
- Staging Pages binds D1 `TRG_ORDERS` → `d92594e8-a45c-4f84-8f48-7c3aeba17f29` (`trg-orders-staging`) and `TRG_OFFICE` → `4c3ae60a-da41-4d65-aee5-a53179fc53f8` (`trg-office-staging`); its R2 buckets are `trg-products-staging`, `trg-forum-avatars-staging`, and `trg-office-archive-staging`.
- The canonical release Preview target is Cloudflare Pages project `tobacco-road-games-acceptance`, using Preview branch `acceptance`. Its Preview and Production environments bind only acceptance D1 `trg-orders-acceptance` (`2fff6e72-4e41-47e7-b497-992dadcab3d6`) and acceptance R2 `trg-products-acceptance`; it has no custom domains and its public site origin is the acceptance `pages.dev` host. The release pipeline builds from a Git archive of the exact pushed SHA, uploads that artifact to the project's Preview branch, verifies the full-SHA marker and artifact fingerprint, and can bind Owner approval to deployment ID, SHA, and fingerprint. The old project `trg-member-tier-test-20261120` is not an active target; historical records mentioning it remain historical.
- Canonical `development` is the accepted reconstructed line based on `main`, followed by the Phase 3B closeout and Phase 5 release/build metadata enforcement. Phase 5 does not alter application behavior, deploy, or modify production/staging.
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

## Migration record (read-only verification, 2026-11-23)

Cloudflare D1 `d1_migrations` and `sqlite_master` were queried read-only. Staging `trg-orders-staging` records numbered migrations through `073_native_open_rules_shelves.sql` (applied 2026-11-12); production `trg-orders` records through `072_storefront_listing_visibility.sql` (applied 2026-11-12). Neither ledger records 074–079. The ledger's integer `id` is an insertion ordinal, not the migration filename number.

The separate focused `account-profile-072` SQL is intentionally outside the numbered D1 ledger and is recorded in `ops/release/migrations.json` and `ops/releases/records/auth-no-email-2026-11-22.json` (SHA-256 `95a67d3f3c1d09c1dd81b604297f7bf6589174288301f87780dc47b0867f2f0c`). Its two tables and index, including all declared columns, are present in both staging and production. This focused SQL supplies the `customer_registration_states` table from 079 and the `creator_commission_category_assignments` table/index from 075; it does not apply either full migration.

| Migration | Source SHA-256 | Staging | Production | Feature status and handling |
| --- | --- | --- | --- | --- |
| 073 `native_open_rules_shelves.sql` | `07116b20d4be3555207bc8b71bc1656fac18af0f3a6b31e3fe7181fcb08c6b89` | Recorded applied 2026-11-12. Storefront config has 13 upper and 0 lower shelf IDs. | Not recorded applied. The upper shelf has 13 IDs; the lower split path is absent. | Shelved. Data-only config change; keep staging state, do not activate the split or reverse the migration. |
| 074 `native_creator_sale_policy_snapshots.sql` | `fd2c7b7c57b3b161754897910b82bb86a436cb8876536908c784db5aa6eb256e` | Not recorded; its seven `order_items` snapshot columns are absent. | Not recorded; its seven `order_items` snapshot columns are absent. | Future/deferred Creator sale-policy snapshot work; leave unapplied. |
| 075 `creator_commission_and_stripe_fee_reconciliation.sql` | `e07934bd67a4fd1b4484e8063e2c357f95e89cbc9699684481a0083c11ebf1f6` | Full migration not recorded. Focused 072 table/index subset exists; the remaining fee tables, triggers, and snapshot columns are absent. | Same as staging. | Future/deferred financial work. The full file would collide on its existing table/index `CREATE`s; do not run it unchanged. Plan a forward-compatible follow-up before any later application. |
| 076 `financial_classification_and_founding25_limit.sql` | `aa64704adfadf1590e4e956eac04f0beb0c31d01c1742a5f67508a24dd1f1783` | Not recorded; its verification column, partial index, and limit triggers are absent. | Not recorded; same objects absent. | Future/deferred Founding-25 financial classification; leave unapplied. |
| 077 `creator_account_capacity_privileges.sql` | `770d547d22be0becbdea720354701d273673bf9ddff9f7a625ba2376394f56c7` | Not recorded; capacity view and four publication/shelf triggers are absent. | Not recorded; same objects absent. | Future/deferred Creator capacity enforcement; leave unapplied. |
| 078 `auth_rate_limit_cleanup_index.sql` | `2de4e97a17218f431cee3a9473fe7c0db45147fc87cc02017e389886afdaa8ca` | Not recorded; `idx_auth_rate_limits_window_started` is absent. | Not recorded; index absent. | Future/deferred R4 throttling cleanup; leave unapplied. |
| 079 `customer_signup_and_saved_cards.sql` | `bbc220500ee6b6b55c2f7c7a4738ff261713691bb17674164a253f7895d390d7` | Full migration not recorded. Focused 072 `customer_registration_states` exists; consent/payment tables and the 079 billing/activation columns are absent. | Same as staging. | Saved-card and consent work shelved; normal authentication does not require pending verification. The full file would collide on the existing registration-state table; plan a forward-compatible follow-up before any later application. |

Staging also records `055_owner_profile_phase1.sql` (applied 2026-10-22) and has five tables absent from production: `account_library_shelf_selections`, `account_profile_preferences`, `creator_profile_posters`, `creator_profile_shelf_selections`, and `profile_customization_audit`. The current `development` and `main` migration directories do not contain 055, and current application source does not reference those tables. The exact historical SQL remains recoverable from preserved `origin/staging` commit `537d48692cb98d44c603bce675ea6d9f97f0cc7a`; do not drop the staging schema or restore 055 into the active numbered migration path without a separate release decision.

No database was written during Phase 4. There is no applied 073–079 migration whose source is absent from all preserved Git history; the staging-only 055 file is absent from canonical `main`/`development` but preserved on `origin/staging`.

## Build limitation observed during Phase 3A

`node scripts/build-store.js` completed but reported zero active products and zero historical records from the checked-in build inputs. It consequently rewrote several generated catalog/storefront pages and removed five checked-in Guest preview-product pages. Those unrelated generated changes were restored and excluded. `npm run build:pages` successfully packaged the committed page set (252 allowlisted files), including the generated canonical Creator Dashboard. The immutable release pipeline builds from the exact committed static artifact; full product-page regeneration from the repository alone remains unfinished and must not be treated as verified by the Pages packaging result.

## Release-state invariants (Phase 5)

- `ops/release/README.md` is the operating guide; Git refs and verified Pages deployment metadata are the state authorities. `main = live`; `development = next`; `release/*` branches are temporary candidate evidence.
- `scripts/release-pipeline.mjs` checks that remote `development` descends from remote `main`, a normal release candidate descends from remote `development`, and the candidate release branch is pushed at the exact full SHA. Emergency/reconciliation lineage exceptions must be typed and reasoned in the hashed build manifest.
- Promotion rejects modified or untracked worktree files. Preview approval, staging verification, production deployment, and focused checks must match the same full source SHA and artifact fingerprint. Before promotion, the rollback snapshot's live source prefix must match `main`; release closeout requires `main` to equal the accepted production SHA and `development` to descend from `main`.
- Environment checks compare the downloaded Pages configuration with the complete checked-in environment binding map. Production D1/R2 resource IDs and buckets cannot appear in the Preview or staging configuration without failing the gate. The wrapper records the previous production deployment ID, URL, branch, environment, source, and capture time before production preflight.
- `[CF-Pages-Skip]` may leave a Cloudflare record marked skipped with idle stages. That is harmless metadata and does not require manual deletion or cleanup automation; investigate only if a build/deploy stage or alias was created.
- Phase 4 migration decisions remain active: staging-only 055 tables are preserved as inert historical residue and 055 is not in the active migration sequence. Migrations 075 and 079 remain unchanged and unapplied; deferred work must use future forward-only collision-safe migrations. Phase 5 performs no migration.
