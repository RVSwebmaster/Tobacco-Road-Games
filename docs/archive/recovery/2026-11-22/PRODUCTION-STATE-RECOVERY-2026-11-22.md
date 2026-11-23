# Production State Recovery Record — 2026-11-22

## Purpose and handling

This record preserves a read-only baseline for the next recovery step. It records the Cloudflare production deployment metadata, Git references, working-tree state, and known production artifacts that are not reproduced by a clean Git checkout.

No deployment, Git metadata operation, database access, migration, authentication request, branch change, or application edit was performed to prepare this record. Production remains CLOSED.

Captured from the canonical repository:

`C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`

Remote `origin`:

`https://github.com/RVSwebmaster/Tobacco-Road-Games.git`

## Cloudflare production deployment

- Pages project: `tobacco-road-games`
- Production deployment ID: `266ae6d5-c699-4727-be58-1093c75cbac2`
- Immutable deployment URL: `https://266ae6d5.tobacco-road-games.pages.dev`
- Production alias: `https://tobaccoroadgames.com`
- Environment: `production`
- Latest-stage result: `deploy / success`
- Deployment created: `2026-11-17T02:05:06.318912Z`
- Deployment modified: `2026-11-17T02:05:08.959999Z`
- Cloudflare source repository: `RVSwebmaster/Tobacco-Road-Games`
- Cloudflare production branch: `main`
- Deployment trigger branch: `main`
- Deployment commit reported by Cloudflare: short SHA `a0758e3`; full Git SHA `a0758e3c4a27800878ac7ed77becb86acfdf0414`
- Commit message: `Double Creator board logo and initials`
- Dirty-build flag: **true** (`commit_dirty: true`)

The deployment ID and immutable URL are the primary references to the deployed artifact. Cloudflare deployment metadata does not expose the exact built Pages Functions bundle.

## Git references at capture

- `origin/main`: `233aa0ce52080736c709ed3664f7de813cff45d7`
- Local `main`: `233aa0ce52080736c709ed3664f7de813cff45d7`
- Current local branch: `release/account-profile-2026-11-21`
- Current local HEAD: `640d1f9561958732f2979b64417ca4566dc079ea`
- Local release-candidate branch HEAD: `640d1f9561958732f2979b64417ca4566dc079ea`
- `origin/release/account-profile-2026-11-21`: `a10bbd33504a9348bd5d12eb73f156e630ab7680`
- The pushed candidate `a10bbd3` has parent `a0758e3`; the local `640d1f9` adds the corrected regression-test commit after that candidate.
- `origin/development`: `f67f5932c5ce5dfc8622cdaadb098b8122d5587a`

At capture, `origin/main` is an ancestor of `a0758e3`; `a0758e3` has 145 commits not reachable from `origin/main`. The production deployment therefore does not match the current `origin/main` tip.

## Repository state

Before creating this record:

```text
## release/account-profile-2026-11-21
?? docs/SITE-BUILD-AUDIT-2026-11-21.md
```

There were no tracked modifications. The existing untracked site audit document was left untouched.

Creating this recovery record adds one more untracked documentation file. No other worktree content was changed.

## Known production source and artifacts

Read-only HTTP checks were made against the public production origin, without logging in or calling production APIs:

- `/` and `/guest/` served Guest storefront HTML with a direct `Login/Signup` link. No Guest login-dialog markup or `guest-login.js` reference was present; production requests for `assets/js/guest-login.js` and `assets/css/guest-login.css` returned 404.
- An unauthenticated GET to `/customer` returned HTTP 200 at that URL with `Guest Landing Page` content and `Login/Signup`; it did not return a redirect location.
- `/creator/` returned HTTP 200 with title `Creator Dashboard`, used the shared upper-cabinet asset, and did not reference Member Profile CSS, identity-board JavaScript, or tier-badge assets.
- `/customer-profile/`, `/founding-25-profile/`, `/premium-creator-profile/`, `/admin-profile/`, and `/owner-profile/` returned 404. Production requests for `assets/css/member-profile.css` and the Creator tier-badge WebP also returned 404.
- The public production responses for `assets/js/creator-dashboard.js`, `assets/js/homepage-shelves.js`, `assets/js/magical-bookshelf.js`, and `assets/js/open-rules-library.js` matched the release-candidate source text after line-ending normalization.
- The live `styles.css` text did not match the local release-candidate stylesheet after line-ending normalization. It did contain `.button:active:not(:disabled)` and `transform: translateY(1px)`. The exact deployed stylesheet variant has not been captured as a repository file.

The Pages deployment metadata does not provide the exact production Functions bundle. The continuity/release record at `origin/development:ops/releases/account-profile-072/README.md` also records the live Functions bundle as unverified. Known recovered source references are in `origin/development` and the focused release branch, including `functions/_lib/homepage-config-d1.mjs`, `functions/_lib/homepage-shelves.mjs`, and `functions/api/homepage-shelves.js`; this does not prove byte-for-byte identity with the production bundle.

The last project-state record says production D1 was at schema 072 as of 2026-11-20. D1 was not accessed for this capture, so that database version is not independently reverified here.

## Reconstruction notes

1. Retrieve the immutable Cloudflare deployment by ID `266ae6d5-c699-4727-be58-1093c75cbac2` or URL `https://266ae6d5.tobacco-road-games.pages.dev` to reference the current deployed artifact.
2. Check out the full Git commit `a0758e3c4a27800878ac7ed77becb86acfdf0414` to reconstruct the clean committed baseline identified by Cloudflare.
3. Do not treat that clean checkout as an exact reproduction: Cloudflare marked the deployment dirty, `origin/main` is at `233aa0ce52080736c709ed3664f7de813cff45d7`, the live stylesheet differs from the release candidate, and the exact Pages Functions bundle is not available in the recorded deployment metadata.
4. The focused account/Profile candidate is separately recorded at `origin/release/account-profile-2026-11-21 @ a10bbd33504a9348bd5d12eb73f156e630ab7680`; it is not the production deployment.

