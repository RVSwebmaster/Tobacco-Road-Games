# TRG release path

## Branch meaning

- `main` is the exact source for live production.
- `development` is the next-development line and must not be treated as production truth.
- `reconcile/*` branches are review candidates. They are not release authorization and are never promoted merely by being pushed.
- A `release/*` branch is temporary release evidence, never a permanent third source of truth. Its candidate must be an exact pushed SHA that descends from canonical `development`, except for an explicitly documented emergency or reconciliation release.

The current accepted source relationship is `main = live` and `development = next`. Git refs and verified Pages deployment metadata are authoritative; this guide does not duplicate their moving SHAs. As recorded for Phase 4, `main` is `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`, Pages deployment `ced34184-fd94-44bc-a9c8-53861774cede`, and `development` is the accepted reconstructed line based on `main`.

## Release gates

The hardened pipeline in `scripts/release-pipeline.mjs` fetches and checks the current remote `main` and `development` refs, requires `development` to descend from `main`, requires a normal release candidate to descend from `development`, and builds from a Git archive of the exact pushed full SHA. It rejects modified or untracked worktree files, validates complete environment maps, fingerprints static output and Functions source, records focused migration receipts, and binds Preview approval, staging checks, and production to one source SHA and artifact fingerprint. A pre-promotion rollback snapshot must identify a live Production deployment whose source prefix matches current `main`. Production closeout requires verified deployment metadata on `main`, an exact full-SHA/static-output marker, and `development` descending from `main`. The Pages build script writes that marker from Cloudflare's injected `CF_PAGES_COMMIT_SHA` and `CF_PAGES_BRANCH` values for Git-connected builds ([Cloudflare Pages build variables](https://developers.cloudflare.com/pages/configuration/build-configuration/)). The deployment wrapper records a complete rollback snapshot before production preflight. It does not authorize deployment by itself: the operator must have the explicit release authorization required by the project workflow.

The standard sequence for a future release is:

1. Confirm `development` descends from current `main`; prepare the candidate at the current `development` SHA. Any exception must be explicit, typed, and recorded with a reason in the hashed release manifest.
2. Push the exact candidate SHA and build its immutable artifact from the Git archive. The release branch is evidence for that candidate, not a separate production baseline.
3. Verify the isolated Preview artifact and bind Owner approval to the exact source SHA and artifact fingerprint when the workflow requires it.
4. Deploy that same artifact to staging, verify it, and create the staging attestation for the exact SHA and fingerprint.
5. Preserve the previous production deployment, then use the production wrapper only after explicit production authorization. It verifies that the current live deployment source matches `main`, checks bindings and migration receipts, and promotes the exact Preview-approved/staging-tested artifact. A live deployment with stale `main` is an open release, not a completed one.
6. Advance `main` to the accepted production SHA through normal Git history. Cloudflare's automatic `main` build is expected; verify the full-SHA marker and source-output fingerprint. Ensure `development` descends from the new `main`, then close the release record only when source, artifact, main, development, and production metadata agree.

Use the commands registered in `package.json` (`release:verify`, `release:build`, `release:verify-artifact`, `release:check-environment`, `release:check-promotion`, `release:approve-preview`, and `release:record`). `release:verify` is local regression verification only; it does not deploy or write to D1.

## Environment safety

`ops/release/environments.json` is the checked-in binding/variable map. Secret values never belong in Git; only secret names/policies may be recorded. Preview and staging maps must contain no production D1 or R2 resource, and production must not bind staging or isolated-test resources. The release gate compares complete binding maps, not only expected entries.

The configured disposable Preview project, `trg-member-tier-test-20261120`, currently returns Cloudflare `Project not found`. Do not substitute the separate acceptance project without an explicit release-environment decision. Preview approval is unavailable until an active isolated target is selected; the deployment wrapper fails closed rather than switching projects.

Production source is branch `main`; staging's Pages deployment branch is `staging`; Preview and its isolated resources are configured in the environment map. The wrapper downloads the actual Pages configuration and checks it against that map before any migration or deployment. Preview/staging production D1 or R2 bindings fail closed. A reconciliation or documentation-only push must not be used as a deployment mechanism. When `[CF-Pages-Skip]` is used, Cloudflare may create a deployment metadata record with `is_skipped=true` and idle build/deploy stages. That record is harmless: it does not deploy, acquire an alias, or access environment resources. Do not treat it as a deployment defect, delete it manually, or add cleanup automation. Investigate only if the record is not marked skipped or any stage/alias indicates execution.

Native Customer registration and login need no email provider, verification service, or Google identity provider. Password recovery remains separately email-dependent. The store remains **CLOSED** until a separate explicit Owner decision changes it.

## Migration discipline

`ops/release/migrations.json` is the ledger for focused release migrations outside the numbered sequence. Release manifests bind SQL hashes, D1 IDs, preconditions, and postconditions to an exact source SHA. The wrapper verifies schema state before it applies any authorized migration, stops on partial state or a wrong target, and records a receipt. Phase 3A did not run migrations 073–079. Their source/environment status is documented in `docs/PROJECT-STATE.md`.

The focused `account-profile-072` migration and its historical verification are recorded in `ops/releases/records/auth-no-email-2026-11-22.json`; this Phase 3A reconstruction does not apply it again.

Phase 4 migration decisions remain in force: staging-only `055_owner_profile_phase1.sql` is historical residue whose tables are preserved but whose migration is inert and excluded from the active sequence. Migrations 075 and 079 remain immutable historical source and unapplied; if those deferred features resume, use new forward-only, collision-safe migrations that add only missing schema. No migration is run as part of Phase 5.

## Rollback

Each production release record retains the immediately previous deployment ID and URL. Application rollback restores that Pages deployment; it does not rewind D1. Preserve account and order data and use a reviewed forward migration for schema corrections. Never treat a dirty Cloudflare artifact as a Git baseline or rebuild a release from uncommitted local files.
