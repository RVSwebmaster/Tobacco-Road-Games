# Operation Scavenger 001 — Acquisition Report

**Date:** 2026-11-18  
**TRG revision inspected:** `8931f6018f8ca800481488dac9cd708c1047dde9`  
**Worktree:** Existing unrelated dirty work preserved. No production access, migration, dependency installation, deployment, or commit.

## Acquired code and completed functionality

No external source code was copied. The approved Creator Profile requirement is complete locally: on `/creator/`, the existing framed poster on the right side of the title board now rotates covers from the selected Creator’s published, publicly listed catalog every 45 seconds. The approved frame remains visible; the Familiar 4 artwork is the frame/backdrop and fallback when no usable catalog cover is available. The private `/creator-dashboard/`, `/authors/<slug>/`, purchased-library shelves, other title-board content, and Guest/Customer layouts remain unchanged.

`renderCreatorIdentityPage()` in `scripts/build-store.js` adds the profile-only cover layer and runtime reference. `assets/js/creator-profile-catalog-rotation.js` reuses authenticated Creator identity selection and the public catalog API; it filters products to the selected Creator and listed same-origin `/product-assets/<slug>/cover.webp` paths. It pauses when the tab is hidden and disables automatic changes for reduced-motion preference. Empty, one-cover, unauthenticated, and API-error cases remain stable. There are no controls, new endpoint, schema, package, or external runtime dependency.

## External candidates screened

| Repository / revision | Source | License and fit | Decision |
|---|---|---|---|
| [Kun Bookshop](https://github.com/thekevinkun/kun-bookshop), `c8c4d536762a67a38c641fefb0cbbfd736e8084e` | `client/src/components/layout/Hero.tsx` (`next`, stable interval, pause state) | No `LICENSE` file or commercial reuse grant found in the cloned repository. React, React Router, Framer Motion, and Kun-specific featured-book props are coupled to its component. | **DISCARD.** Do not copy unlicensed code. |
| [Embla Carousel](https://github.com/davidjerleke/embla-carousel), `0423b61463dd6f095d7aca810a49bbf194d6c291` | `packages/embla-carousel-autoplay/src/components/Autoplay.ts`; `packages/embla-carousel/src/components/EmblaCarousel.ts` | MIT licensed; adapting the fixed poster frame into a carousel would change the approved display structure and add more integration than the simple timer requires. | **STUDY.** No code/package added. |
| [Digital Sales Platform](https://github.com/Kylelau339/digital-sales-platform), `6bc801cd620556a83e396bc9c2fc5e2c8e916cde` | `apps/api/src/scanning/scan-worker.ts` | MIT licensed but unrelated to cover rotation and depends on Node filesystem descriptors/streams and `yauzl`, unlike TRG’s Workers path. | **DISCARD for this batch.** |

Kun Bookshop and Digital Sales Platform were cloned only into the established external research directory. GitHub is not used at runtime.

## Development eliminated

Reusing TRG’s existing authenticated Creator identity selection, public catalog endpoint, R2 cover URLs, and approved framed-poster placement avoided an estimated **0.5–1 developer-day** for a new Creator catalog endpoint and separate display/frame integration. The external repositories eliminated **no** TRG implementation work; adding their frameworks or carousel structure would increase cost. The custom timer and its isolated regression took approximately **0.5 developer-day** to adapt and verify.

## Verification

- Passed: `npm run test:creator-profile-cover-rotation` (Creator selection, catalog attribution/visibility, same-origin paths, 45-second advance/wrap, hidden-tab pause/resume, reduced motion, and empty/single/error fallback).
- Passed: `node scripts/test-creator-open-rules-data.js`.
- Passed: `node scripts/test-storefront-shared-cabinet.js`.
- Passed: `node scripts/test-public-product-catalog.js`.
- Passed: `npm run test:storefront-visual`; no baselines were regenerated.
- The full `npm run verify:launch` gate was not rerun; this report does not claim a new whole-launch result. The dynamic frame was verified through isolated DOM/timer tests and static visual/layout regressions, not a live-browser screenshot comparison.
- A separate remote Creator staging test was invoked without its required URL and exited at URL parsing (`ERR_INVALID_URL`) before making a network request. It is unrelated to this feature and is not counted as an acceptance test.

The report and continuity updates are local only. The remaining listed acquisition repositories were not screened in this first completed batch; additional work can proceed in a later batch.
