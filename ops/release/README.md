# TRG release path

## Path

Use a pushed release commit as the only source for a release:

`development` → `release/<name>` → isolated Preview → Owner approval → staging → production

The commit tested in Preview, staging, and production must be the same full Git SHA. A changed commit requires a new build and new Owner approval. A release must have no tracked working-tree changes and its release branch must exist on `origin` before any deployment.

Create a release branch from the approved baseline and bring in only the changes selected for that release. Development may continue independently; do not merge all of `development` into a release branch unless every included change is approved for that release.

## Current Git and production references — 2026-11-22

`development` is the canonical ongoing work branch. The current production source is `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`, retained on `release/account-profile-2026-11-21` and recorded with deployment `cdad3de6-b4da-47e2-b639-f3aca1a6646b` in `ops/releases/records/auth-no-email-2026-11-22.json`. Cloudflare labels that deployment with branch `main`, but its source SHA is the release commit; do not infer the deployed source from the GitHub `main` tip. The `main` and `staging` names remain Pages environment branch selectors. Never delete or repurpose the live release ref until a later production release record replaces it.

The configured Preview acceptance project is `trg-member-tier-test-20261120`, branch `test`. Both its Preview and Production Pages configurations are restricted to isolated D1 `6248efe2-c96d-457e-b705-376cf5485c04`; it has no R2 bindings and its public origin is its own `pages.dev` host. Its production branch is the guard branch `trg-member-tier-production-guard`. The old deployment `9d2a9f5e` is a historical dirty Preview snapshot, not a clean approval or source for the current authentication release. Every future approval must identify its own clean deployment, SHA, and manifest.

## Build and promotion commands

From the canonical repository root, after the release branch has been pushed:

```powershell
npm run release:verify
npm run release:build -- --ref <full-sha> --release-branch <release-branch> --release-id <release-id> [--migration account-profile-072]
.\ops\release\deploy.ps1 -Target preview -ReleaseId <release-id>
```

Open the generated Preview URL and obtain RV's approval for that exact release. Then record it:

```powershell
npm run release:approve-preview -- --release-id <release-id> --deployment-id <preview-deployment-id> --deployment-list .wrangler/release-pipeline/<release-id>/preview-deployments.json --approved-by RV
```

Only after that record succeeds, deploy and verify staging:

```powershell
.\ops\release\deploy.ps1 -Target staging -ReleaseId <release-id>
.\ops\release\verify-staging.ps1 -ReleaseId <release-id>
```

After staging checks pass, preserve the previous production deployment in the release workspace, then promote the same build:

```powershell
.\ops\release\deploy.ps1 -Target production -ReleaseId <release-id>
```

The wrapper downloads the target Pages configuration into the ignored release workspace, validates the project name, Preview and Production D1/R2 maps, required public variables, deployment branch/environment, clean tracked tree, pushed SHA, release manifest, approval, staging attestation, and rollback deployment before upload. It passes the full SHA and `--commit-dirty=false` to Wrangler, then checks the deployment record and fetches `trg-release.json` from the deployed URL to compare the full SHA and static build fingerprint.

The artifact is built once from `git archive` of the pushed release SHA. The same static Pages directory is reused for Preview, staging, and production. Wrangler compiles Pages Functions for the target Pages project at upload time; the Functions source hash is in the build manifest, and target-specific generated route identifiers are not treated as source differences. Environment bindings are supplied only by the downloaded target config and must match `environments.json` exactly.

`npm run release:verify` runs the release gate regression, navigation, Pages build/environment isolation, and locked storefront-visual checks. It does not deploy or write to D1. The deployment wrapper runs authentication and account-page regressions from the exact archived release SHA before it uploads that candidate; this prevents tests from a different local checkout from standing in for the release source.

## Configuration and secrets

`ops/release/environments.json` is the checked-in environment map. It contains repository-safe nonsecret variables, Pages project names and branches, D1 identifiers, R2 bucket names, public origins, and feature flags. Secret values never belong in Git. Use Wrangler/Cloudflare encrypted secrets; `wrangler pages secret list` exposes names and encryption state only.

Native Customer registration and password login require no email-provider or Google secrets. The existing Resend settings are optional for the separately email-dependent password-reset flow. No Gmail SMTP, Resend, SMTP2GO, or Google authentication work is part of the release path.

Preview and staging must never bind production D1 or R2 resources. Production must never bind staging or isolated-test resources. Any missing or extra D1/R2 binding fails the gate. Preview's configured public origin must remain its own isolated Pages host; staging and production origins must match their respective environments.

## Schema discipline

`migrations.json` is the explicit ledger for focused release migrations outside the numbered sequence. Each release manifest lists every required migration ID, exact SQL hash, database binding and environment-specific D1 ID, expected pre-migration state, and postconditions. During promotion the wrapper reads the actual target D1 schema. If the postconditions are absent and the preconditions are present, it applies the archived SQL from the exact release SHA; if the postconditions are already present, it verifies them and skips reapplication. A partial migration or wrong database stops promotion. It writes a per-release migration receipt bound to the target, D1 ID, release SHA, and manifest hash. Staging receives and verifies its migration before staging deployment and checks; production captures its rollback deployment first, then applies/verifies the same migration immediately before deployment. The promotion gate requires the matching target receipt. Preview uses only its isolated mapped D1. Never rewrite numbered historical migrations as a release shortcut.

Migration `account-profile-072` has SHA-256 `95a67d3f3c1d09c1dd81b604297f7bf6589174288301f87780dc47b0867f2f0c`. It was applied to staging before the authentication flow was tested and is present on production. Its additions are `customer_registration_states`, `creator_commission_category_assignments`, and `idx_creator_commission_assignments_current`. It is additive; production schema rollback is not required for the current release.

## Rollback

Each production release record stores the immediately preceding successful production deployment ID and URL. Restore that Pages deployment from the Cloudflare Pages deployment list/dashboard; do not rebuild from a local checkout. Keep D1 data and schema in place during an application rollback. The focused account/Profile migration is additive, and deleting or time-travelling production D1 can discard registrations or other account data. Prefer a forward application fix. Before any exceptional database restore, export/preserve current data and confirm the migration is reversible and no post-migration writes would be lost.

The current production rollback anchor before the authentication release was deployment `1a44e956-7700-4f9f-bac7-9c2edb705612`. The earlier known-approved code baseline `530066f2-e8c9-4411-8fd8-fdd240135ec0` predates immediate-use registration; restoring it would reinstate the previous verification-gated login behavior.

## Current release record

`ops/releases/records/auth-no-email-2026-11-22.json` records the Owner-directed authentication release and its staging/production deployments. That direct Phase 1 promotion was explicitly authorized after staging passed; it is recorded as a directed exception because the older dirty Preview is not approval for this newer SHA. All future releases must use the exact-commit Preview approval gate above.
