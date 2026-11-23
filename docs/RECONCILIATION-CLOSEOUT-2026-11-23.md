# TRG Repository Reconciliation Closeout

**Status: Phase 6 structural verification, 2026-11-23. Production remains CLOSED.** This is the concise closeout record for the reconciliation; current branch SHAs are read from Git refs, and deployment identity from Cloudflare metadata.

## Why reconciliation was required

At the start of reconciliation, GitHub `main` was `233aa0ce52080736c709ed3664f7de813cff45d7`, accepted production was `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`, and old `development` was `e796fd8fd8b4aad8eeb61f284eec0d029b2552a6`. The live source was 149 commits ahead of old `main`; development was a separate mixed line. The live production source was preserved before `main` was fast-forwarded to it. `development` was then reconstructed from corrected `main` with approved continuing and deferred work only.

## Canonical operating model

- **`main` = accepted production source.** The verified production deployment is `ced34184-fd94-44bc-a9c8-53861774cede`, sourced from `main` at `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`, `dirty=false`.
- **`development` = next work.** Phase 6 began at `a4b8292e281f3795ed365d8cffc9810bdc6da81f`; this documentation-only closeout is committed on `development`. The exact final SHA is the current Git ref and is included in the Phase 6 report.
- Normal work starts from current `development`; it must descend from `main`. A normal release candidate must be pushed and descend from current `development`.
- `release/*` refs are temporary evidence/mechanisms, not a third permanent source of truth. Preview approval, staging verification, and production promotion bind the same exact source SHA and artifact fingerprint. Production closeout requires `main` to equal the accepted live source and `development` to descend from `main`.
- Emergency/reconciliation lineage exceptions must be explicit, typed, and recorded in the hashed release manifest. Environment checks isolate production, staging, and acceptance bindings.

## Preserved refs and historical branches

These remote refs are retained as recovery/history, not as active development or release sources:

| Preserved ref | Exact target | Disposition |
| --- | --- | --- |
| `preserve/pre-reconcile-2026-11-23-main-233aa0c` | `233aa0ce52080736c709ed3664f7de813cff45d7` | Pre-reconciliation `main` |
| `preserve/pre-reconcile-2026-11-23-development-e796fd8` | `e796fd8fd8b4aad8eeb61f284eec0d029b2552a6` | Pre-reconciliation `development` |
| `preserve/pre-reconcile-2026-11-23-production-1b1a8a7` | `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6` | Pre-reconciliation live production source |
| `reconcile/development-2026-11-23` | `8288d954cee35c323a577f05f744d94f09801fe8` | Accepted Phase 3A reconstruction snapshot; historical |
| `release/phase5a-preview-2026-11-23` | Phase 5A candidate `a4b8292e281f3795ed365d8cffc9810bdc6da81f` | Temporary acceptance evidence for deployment `6c0c4787-419d-458d-a8c0-25c961f9df8c`; historical after the closeout docs commit |

The retained `release/account-profile-2026-11-21` ref points to corrected `main` at `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`; its release record is historical. The pipeline will not accept it as a normal candidate unless its ref is moved to an exact SHA descending from current `development`. `origin/staging` is the Pages staging deployment line, not the development source. Its historical `055_owner_profile_phase1.sql` source is preserved in Git history, outside the active migration sequence. The approved `trg-member-profile-base-v1` tag is also retained as historical implementation evidence.

## Preview and resource isolation

The canonical Preview project is `tobacco-road-games-acceptance`. Its verified Preview deployment is `6c0c4787-419d-458d-a8c0-25c961f9df8c`, sourced from Phase 5A SHA `a4b8292e281f3795ed365d8cffc9810bdc6da81f`, `dirty=false`, on branch `acceptance`. Both Pages environments use only acceptance D1 `2fff6e72-4e41-47e7-b497-992dadcab3d6` and R2 `trg-products-acceptance`; the project has no custom domains. The retired `trg-member-tier-test-20261120` is absent from the active environment map. Historical release records may still mention it.

## Migration disposition

- `055_owner_profile_phase1.sql`: staging-only historical residue. Preserve its tables and source; it is absent from the active migration sequence and current application code.
- Focused `account-profile-072`: additive focused migration already verified on staging and production; its receipt and SQL hash are in `ops/release/migrations.json` and the historical release record. Do not rerun it as part of closeout.
- `073_native_open_rules_shelves.sql`: shelved split; staging data/config remains as recorded, production was not given the split.
- `074_native_creator_sale_policy_snapshots.sql`: deferred and unapplied.
- `075_creator_commission_and_stripe_fee_reconciliation.sql`: deferred; a future release needs a collision-safe forward migration because the focused account/Profile migration already created part of its schema.
- `076_financial_classification_and_founding25_limit.sql`, `077_creator_account_capacity_privileges.sql`, and `078_auth_rate_limit_cleanup_index.sql`: deferred and unapplied.
- `079_customer_signup_and_saved_cards.sql`: saved-card/consent work is shelved; the full migration is unapplied. Any resumed work requires a collision-safe forward migration because the focused migration already created `customer_registration_states`.

Historical SQL is not rewritten or renumbered. Phase 6 ran no migrations.

## Accepted and excluded boundaries

Current accepted work includes `/creator-dashboard/`, accepted Creator/Profile furniture, the six temporary Profile routes and shared renderer, native email/password authentication without an email-verification gate, release-pipeline hardening, and the isolated acceptance Preview target.

Excluded or superseded: Google authentication, verification-gated ordinary registration, the rejected `/account.html` presentation, obsolete Guest/Customer navigation, bare `openRules` behavior, and staging logout redirects to production.

Deferred or shelved: financial/accounting work, Founding-25/capacity enforcement, email recovery/reset, default Creator catalog-cover rotation, Stripe Express/CSV sandbox, SMTP prototype, Open Rules upper/lower shelf split, and saved-card/payment methods.

## Known build limitation and Phase 6 boundary

`node scripts/build-store.js` has reported zero active products and zero historical product records in repository build inputs and may rewrite generated storefront/catalog outputs. This was previously observed and is reserved for the fresh post-reconciliation audit. Phase 6 did not run the full generator, alter application behavior, deploy staging or production, or run migrations. Production deployment `ced34184-fd94-44bc-a9c8-53861774cede` and staging deployment `f9f94dba-0292-4e18-90d9-65e96846cdaa` remain unchanged.
