# Tobacco Road Games Pages deployment runbook

## Deployment boundaries

- `main` is the production branch for the Git-connected `tobacco-road-games` Pages project.
- `staging` is excluded from that project's Preview deployments. Pushing `staging` must not deploy either Pages project.
- Isolated staging is the direct-upload project `tobacco-road-games-staging`.
- The staging script must be run from a clean, committed `staging` checkout. It never targets the production project.
- Keep both stores `CLOSED` unless RV separately authorizes opening one.

## Deterministic build output

`npm run build:pages` creates `.wrangler/production-pages-output` from a fixed allowlist of public files and directories. Cloudflare Pages Functions remain in the repository's `functions/` directory for Wrangler to compile. Local workshop content, source documentation, tests, Git metadata, dependencies, and secrets are not copied.

The Git-connected production project uses:

- Build command: `npm run build:pages`
- Build output directory: `.wrangler/production-pages-output`
- Root directory: repository root

Do not retry a Git build for a commit that predates this build script.

## Preflight

From the canonical repository on `staging`:

```powershell
git status --short --branch
npm run test:pages-build
npm test
git diff --check
```

The working tree must be clean before deployment. Confirm `ops/staging/wrangler.pages.toml` still names `tobacco-road-games-staging` and only staging D1/R2 bindings.

## Direct staging deployment

```powershell
git switch staging
.\ops\staging\deploy.ps1
```

The script protects the approved storefront visuals, temporarily installs the staging Wrangler configuration, builds an allowlisted output directory, deploys only to `tobacco-road-games-staging`, and removes temporary build/configuration files in `finally` cleanup.

Afterward verify:

- the reported deployment belongs to `tobacco-road-games-staging` and the expected commit;
- `https://tobacco-road-games-staging.pages.dev/api/store/status` reports `CLOSED`;
- the homepage, store, account, Creator, and Owner surfaces respond as expected;
- the deployment has `trg-orders-staging`, `trg-products-staging`, staging forum storage, and staging Office bindings;
- production status and its latest deployment did not change;
- `git status --short --branch` is clean and no root `wrangler.toml` remains.

## Custom domain

`staging.tobaccoroadgames.com` belongs on `tobacco-road-games-staging`, never on the production-connected project. `tobaccoroadgames.com` remains attached only to `tobacco-road-games`. Moving the staging hostname must not change the production hostname or `office-staging.tobaccoroadgames.com`.

## Recovery

If a staging direct upload fails, do not touch production. Confirm the script removed root `wrangler.toml` and `.wrangler/staging-pages-output`, fix only the diagnosed staging/build issue, rerun the preflight, then rerun the script. The previous successful isolated deployment remains available in Cloudflare Pages and can be rolled back there if a new staging deployment is defective.

If the staging custom domain fails after a safe move, keep the isolated `pages.dev` hostname as the review URL while Cloudflare reprovisions the domain. Reattach only `staging.tobaccoroadgames.com`; never remove or alter `tobaccoroadgames.com`.
