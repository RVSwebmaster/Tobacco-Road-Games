# Focused production account and Profile release

Reconciled 2026-11-20. The recipe starts at production revision `a0758e3`. Cloudflare deployment `266ae6d5-c699-4727-be58-1093c75cbac2` records that revision with a dirty build. The recovered upload and the live public files established the differences below. Cloudflare did not provide the exact deployed Functions bundle for a byte comparison.

## Reconciled behavior

- `assets/js/creator-dashboard.js` uses the recovered live blob from `25f23d0`. It validates the saved draft against the persisted listing and confirms the saved fields after PDF upload before reporting success. The existing Dashboard stays at `/temp-creator/`.
- `functions/_lib/homepage-config-d1.mjs`, `functions/_lib/homepage-shelves.mjs`, and `functions/api/homepage-shelves.js` use the recovered live blobs from `f7ab989`. D1 configuration determines shelf contents and order. An empty shelf stays empty. The endpoint advertises a 60-second cache on success and uses `no-store` when unavailable.
- `styles.css` retains the live 1px downward press effect for enabled buttons and the approved storefront styling. The Guest landing CSS and the homepage-shelves, magical-bookshelf, and Open Rules client scripts retain the recovered live versions. The Guest product preview and progressive navigation scripts use the approved account/Profile versions with the shared library behavior.
- The shared Profile renderer supersedes the old Creator identity board and manual sizing. The package removes the retired Creator board stylesheet and the old Creator-only Open Rules script. The shared generator rebuilds the Guest and Customer storefronts and all six Profile pages. The frozen cabinet artwork stays intact.
- The [file manifest](release-files.tsv) lists every application difference from `a0758e3`. Unrelated marketplace and payment code stays at the baseline revision.

## Build and rehearse locally

Run from the canonical repository with its installed Node dependencies and Chrome or Edge.

```powershell
$release = node ops/releases/account-profile-072/prepare.mjs
$site = Join-Path $release site
node "$site/scripts/build-pages-output.mjs" --output "$site/.wrangler/focused-pages-output"
.\node_modules\.bin\wrangler.cmd pages functions build "$site/functions" --cwd "$site" --outfile "$release/rehearsal-worker.bundle" --compatibility-date 2026-06-18
node ops/releases/account-profile-072/rehearse.mjs "$release"
```

The recipe pins each source revision, archives a fresh candidate under ignored `.wrangler/`, and checks the resulting manifest. The test recreates schema 072 in memory, applies the focused SQL, verifies six synthetic sign-ins and logout revocations, checks the exact Profile markup, tests the recovered shelf service, and exercises the Guest-to-Customer-to-Profile flow in Chromium over loopback. The 250-file Pages allowlist and Functions bundle build locally.

Development regressions passed for storefront visuals, Member Profiles, progressive navigation, Creator PDF intake, Open Rules shelves, Pages packaging and environment isolation, Creator cover rotation, account auth, and Guest landing behavior.

## Schema and rollout status

[Focused SQL](account-profile-072.sql) adds `customer_registration_states` from 079 and `creator_commission_category_assignments` plus its lookup index from 075. Existing users, credentials, and other schema objects remain intact. The two new tables start empty. This fragment runs directly on 072 independently of migrations 073–078. The later full 075 and 079 migrations must account for the tables and index already present, including 075's broader category constraint. The focused fragment leaves the numbered migration ledger at 072.

Existing members without a registration state retain their original access. Signup and password reset retain their existing handlers. Email was stubbed during rehearsal. Production currently reports `RESEND_DELIVERY_ENABLED=false`, so verification and reset delivery remain a release gate if required. Founding-25 badges require valid assignments, and the patch seeds none.

Production continues to serve the existing deployment. The tracked recipe reconstructs the approved behavior and release additions from Git. The exact live Functions bundle remains unverified, and production bindings and D1 records remain external to Git.
