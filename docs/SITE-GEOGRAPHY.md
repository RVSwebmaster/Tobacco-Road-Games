# TRG site geography

Status verified 2026-11-23 against the canonical repository and the Phase 3A reconstruction candidate.

## Canonical source locations

| Concern | Source |
| --- | --- |
| Storefront, Profile, and Dashboard generation | `scripts/build-store.js` plus `templates/` |
| Pages artifact allowlist | `scripts/build-pages-output.mjs` |
| Browser behavior and presentation | `assets/js/`, `assets/css/`, and `styles.css` |
| Request/API behavior | `functions/`; `_routes.json` selects function-backed routes |
| Release gates and environment map | `scripts/release-pipeline.mjs`, `ops/release/`, and `ops/releases/` |
| Current architecture and status | `docs/PAGE-ARCHITECTURE.md`, `docs/MEMBER-ACCOUNT-ARCHITECTURE.md`, and `docs/PROJECT-STATE.md` |

The production-connected workspace is `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`. Deployment artifacts are assembled in ignored `.wrangler/` directories; those files are not source or acceptance records.

## Public and member routes

| Route | Owner/source | State |
| --- | --- | --- |
| `/` and `/guest/` | Guest storefront from `scripts/build-store.js`; root rewrite is in `_redirects` | Public guest storefront; Login/Signup opens the approved compact login popup |
| `/customer` | `customer.html`, generated from Guest by `renderCustomerLandingPage()` | Session-protected Customer Storefront; signed-out requests redirect to `/guest/` |
| `/customer-profile/`, `/creator/`, `/founding-25-profile/`, `/premium-creator-profile/`, `/admin-profile/`, `/owner-profile/` | `renderMemberProfilePage()` | Six retained temporary HTML entry points over the shared Member Profile Base |
| `/creator-dashboard/` | `templates/creator-dashboard.html` plus `buildCreatorDashboardPage()` | Canonical Creator Dashboard route; the former `/temp-creator/` path redirects here |
| `/authors/<slug>/` | Author page generator | Public author pages, distinct from member Profiles |

The Profile routes remain until a dynamically populated member-specific replacement is approved. The shared Profile renderer and approved cabinet artwork are preserved; no route retirement or furniture redesign is part of Phase 3A.

## Deployment boundaries

`main` represents the live production source. `development` is the next-development line. Reconciliation and release branches are review artifacts, not deployment authorization. `ops/release/environments.json` records the separate isolated Preview, staging, and production resource maps. Phase 3A makes no deployment or database change.
