# Tobacco Road Games — Claude Code Handoff

Date: 2026-10-25

This document records the actual repository and deployed state at handoff. It is not a proposal for new work.

## Repository state

- Canonical workspace: `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`
- Current branch: `staging`
- Local `staging`: `261005d8410b5ce06ec558c5781368af3ea1c1ce`
- `origin/staging`: `261005d8410b5ce06ec558c5781368af3ea1c1ce`
- Local `main`: `16392e0c5e41dcc32d6205afdde08eb15cc05a92`
- `origin/main`: `16392e0c5e41dcc32d6205afdde08eb15cc05a92`
- Working tree: clean; no untracked files were present at closeout.

The staging branch contains commit `261005d` (`Restore bookshelf runtime behavior without Replay control`) and the preceding Guest preview/native-link commits. Staging was pushed normally; no force push, merge, rebase, or production deployment was performed.

## Deployments and store state

- Staging Guest preview: https://30cd4eb9.tobacco-road-games-staging.pages.dev/guest/
- Staging Pages deployment: `30cd4eb9-4ac6-4dd7-8ba9-b75b32b4dffa`, source `261005d`.
- Production site: https://tobaccoroadgames.com/
- Production commit: `16392e0c5e41dcc32d6205afdde08eb15cc05a92`.
- No production deployment occurred during this handoff.
- `/api/store/status` reported `CLOSED` in both environments at closeout. The API also reports `available: true`, which represents continued browsing availability; checkout remains guarded separately.

## Guest storefront implementation

- The production homepage remains `index.html`; the Guest implementation is `guest/index.html` and is built/generated through `scripts/build-store.js` and `scripts/build-pages-output.mjs`.
- Guest assets are primarily under `assets/css/guest-landing.css`, `assets/js/magical-bookshelf.js`, `assets/js/guest-product-preview.js`, `assets/js/news-chyron.js`, and the shared storefront assets.
- The Guest page has seven ordered shelf containers. Open Rules uses 36 staging decorative positions (18 upper, 18 lower); lower merchandising shelves are populated from the staging presentation collections.
- Erin’s animation starts shelves pending, reveals two books every 500ms in shelf order, uses the established left/right stacking directions, and adds the existing randomized flashes and sparks. Reduced-motion and non-desktop paths reveal books without the animated effects.
- SPACE while the sequence is running calls the existing runner finish path, reveals all remaining books, and clears effects. SPACE after completion does not restart anything.
- The Replay button was intentionally removed from the Guest markup and generator. There is no Replay control in the current deployed page.
- Approved hover behavior remains the shared 10px lift, scale/depth treatment, 200ms transition, front stacking, and reduced-motion handling.
- Visible books use native anchor links. Catalog-associated books open the shared product-summary overlay; the overlay close button and Escape close it and restore focus. The summary provides navigation to the full product profile route.
- Staging-only fixture associations are rendered by the Guest presentation data. They are not production catalog records and must not be treated as live inventory.
- The real production catalog was empty at the last catalog cleanup; no production products were created by the Guest preview work.

### Browser verification actually performed

On the deployed staging URL, the following were verified:

- SPACE during loading revealed the full visible shelf set and did not restart on a second SPACE.
- A lower Open Rules book exposed a native link and opened the preview overlay.
- The overlay close button and Escape returned to the storefront.
- The Replay button was absent.

Not individually browser-tested: every one of the approximately 165 visible book links, every full-product route, every hover target, and every responsive breakpoint. Automated tests cover the shared contracts, but they are not substitutes for those unperformed manual checks.

## Architecture inventory

- Cloudflare Pages serves static output plus Pages Functions from `functions/`. The allowlisted staging deployment is `ops/staging/deploy.ps1`; it targets the isolated project `tobacco-road-games-staging`.
- The shared route manifest is `_routes.json`. Important public routes include `/api/news`, `/api/store/status`, `/api/cart/*`, `/api/stripe/webhook`, `/api/resend/webhook`, account routes, Creator routes, Owner routes, and Office routes.
- Staging Pages bindings are defined in `ops/staging/wrangler.pages.toml`: D1 `trg-orders-staging`, R2 `trg-products-staging`, `trg-forum-avatars-staging`, Office D1 `trg-office-staging`, and Office archive R2 `trg-office-archive-staging`.
- Staging has a separate local-owner configuration in `ops/staging/wrangler.local-owner.toml`. Do not use it as a public authentication design.
- The repository contains marketplace migrations through `056_news_chiron.sql` plus Office migrations. Exact remote migration state should be read before applying any migration; do not rerun completed migrations.
- Product delivery uses private R2-backed assets through `functions/store/*`, `functions/product-assets/*`, and the order/delivery libraries. Storage buckets are environment-specific; do not point staging at production buckets.
- Stripe checkout is implemented in `functions/_lib/cart-checkout.mjs` and related checkout/creator-balance modules. Staging configuration is test/sandbox-only and checkout is blocked while the store is CLOSED. Do not use live keys in staging.
- Resend email delivery and webhook verification are handled by the checkout-email and Resend webhook functions. Staging configuration is controlled by the scripts under `ops/staging/`; secrets are not documented here.
- Owner administration is under `functions/owner/*` and protected by the existing Owner/session/CSRF and production Cloudflare Access arrangements. Do not weaken or replace those protections as part of Guest work.
- News is D1-backed through `functions/_lib/news-service.mjs` and `functions/api/news.js`, with Owner controls under `functions/owner/api/news.js` and the scheduled worker `workers/news-collector.mjs`. The checked-in staging collector config currently shows `*/30 * * * *`; confirm the intended production/staging schedule before changing it.

## Protected baselines and precautions

- `AGENTS.md` is authoritative for this workspace and protects the approved storefront artwork baselines.
- `docs/GUEST-BOOKSHELF-BASELINE.md` records the approved Guest bookshelf behavior.
- `docs/DEPLOYMENT-HANDOFF.md` and `DEPLOY_TARGETS.md` describe deployment boundaries and allowlisted output.
- Never work from `C:\Users\rvsaw\Desktop\TobaccoRoadGames`; it is stale.
- Do not deploy staging changes to production, merge `staging` into `main`, or open either store without a separate explicit authorization.
- Do not commit secrets, `.wrangler` state, Miniflare databases, temporary workshop files, or generated deployment output.

## Status and outstanding work

Completed and verified for this handoff: Guest shelf animation baseline, Spacebar completion, Replay removal, native book links, shared preview overlay behavior, staging deployment, full test suite, and GitHub synchronization.

Outstanding or intentionally unverified: production promotion of the latest staging Guest changes; comprehensive manual browser coverage of every book and responsive breakpoint; final operational configuration review for news scheduling, email, Stripe sandbox credentials, and Owner onboarding; and any future product/catalog launch work. These are not claims of failure—only explicit handoff boundaries.

## Reproducible verification commands

From the canonical workspace:

```powershell
npm.cmd run test:guest-bookshelf-baseline
npm.cmd run test:guest-landing
node scripts/test-magical-bookshelf-animation.js
npm.cmd run test:guest-product-preview
npm.cmd test
git diff --check
```

The final closeout run passed all commands above. The staging deployment procedure remains:

```powershell
.\ops\staging\deploy.ps1
```

That procedure is isolated to the staging Pages project and must not be repointed at production.

