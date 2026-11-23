# TRG release path

## Branch meaning

- `main` is the exact source for live production.
- `development` is the next-development line and must not be treated as production truth.
- `reconcile/*` branches are review candidates. They are not release authorization and are never promoted merely by being pushed.
- A `release/*` branch contains one focused candidate from an explicitly selected baseline. Deployments must use the same immutable, pushed SHA through the applicable release gates.

The production source as verified for Phase 3A is `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6` on `main`, served by Pages deployment `ced34184-fd94-44bc-a9c8-53861774cede`. The previous release record `ops/releases/records/auth-no-email-2026-11-22.json` records the earlier deployment `cdad3de6-b4da-47e2-b639-f3aca1a6646b`; Cloudflare subsequently rebuilt the same source SHA after the clean-checkout build-path repair. Current `development` remains the preserved pre-reconciliation line until Friday accepts a reconstructed replacement.

## Release gates

The hardened pipeline in `scripts/release-pipeline.mjs` builds from a Git archive of the pushed full SHA, validates a clean tracked tree and exact environment maps, fingerprints the static artifact and Functions source, records focused migration receipts, and requires exact-SHA approval/staging evidence for promotion. `ops/release/deploy.ps1` is the deployment wrapper. It does not authorize deployment by itself: the operator must have the explicit release authorization required by the project workflow.

The standard sequence for a future release is:

1. Select a focused source baseline and prepare a `release/*` candidate without merging all of `development`.
2. Push the exact candidate SHA and build its immutable artifact from Git.
3. Verify the isolated Preview artifact and record Owner approval for that SHA when the workflow requires it.
4. Deploy that same artifact to staging, verify it, and create the staging attestation.
5. Preserve the previous production deployment, validate production bindings/schema receipts, and promote only with explicit production authorization.

Use the commands registered in `package.json` (`release:verify`, `release:build`, `release:verify-artifact`, `release:check-environment`, `release:check-promotion`, `release:approve-preview`, and `release:record`). `release:verify` is local regression verification only; it does not deploy or write to D1.

## Environment safety

`ops/release/environments.json` is the checked-in binding/variable map. Secret values never belong in Git; only secret names/policies may be recorded. Preview and staging maps must contain no production D1 or R2 resource, and production must not bind staging or isolated-test resources. The release gate compares complete binding maps, not only expected entries.

Production source is branch `main`; staging's Pages deployment branch is `staging`; the isolated account test project is separately configured in the environment map. A reconciliation-branch push must not be used as a deployment mechanism. When a GitHub-connected Pages project would otherwise build a branch push, use the supported `[CF-Pages-Skip]` commit-message marker for reconciliation-only commits and verify no deployment was created. Do not change Cloudflare settings as a substitute.

Native Customer registration and login need no email provider, verification service, or Google identity provider. Password recovery remains separately email-dependent. The store remains **CLOSED** until a separate explicit Owner decision changes it.

## Migration discipline

`ops/release/migrations.json` is the ledger for focused release migrations outside the numbered sequence. Release manifests bind SQL hashes, D1 IDs, preconditions, and postconditions to an exact source SHA. The wrapper verifies schema state before it applies any authorized migration, stops on partial state or a wrong target, and records a receipt. Phase 3A did not run migrations 073–079. Their source/environment status is documented in `docs/PROJECT-STATE.md`.

The focused `account-profile-072` migration and its historical verification are recorded in `ops/releases/records/auth-no-email-2026-11-22.json`; this Phase 3A reconstruction does not apply it again.

## Rollback

Each production release record retains the immediately previous deployment ID and URL. Application rollback restores that Pages deployment; it does not rewind D1. Preserve account and order data and use a reviewed forward migration for schema corrections. Never treat a dirty Cloudflare artifact as a Git baseline or rebuild a release from uncommitted local files.
