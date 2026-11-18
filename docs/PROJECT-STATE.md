# TRG project state

Last reconciled: 2026-11-17. This is a working-state record, not a deployment status page.

## Source-control checkpoint

- Canonical repository: `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`.
- Active development branch: `codex/operation-severance-task1`.
- Documentation baseline at the start of this continuity update: `c03c60eebcf026d724d87c67b9bca71e9d9aec55`, synchronized with `origin/codex/operation-severance-task1`.
- The preceding approved-architecture commits are `ae1af4a` (shared cabinet rendering) and `c03c60e` (separate Creator identity follow-up note).
- At that checkpoint, the worktree contained only these untracked items: `pnpm-lock.yaml`, `scripts/test-creator-open-rules-data.js`, and `title-card/`. They were intentionally excluded from the architecture commits and preserved in the external recovery copy below. Recheck Git before relying on this snapshot.
- Recovery copy: `C:\Users\rvsaw\Desktop\TRG-continuity-20261117-1794935441194`. Its tracked-change patch passed `git apply --reverse --check`; copied entries matched the recorded hashes at verification. A newer full working-tree recovery copy was created for this reset at `C:\Users\rvsaw\Desktop\TRG-recovery-20261117-133059` (excluding only `.git`, `node_modules`, and `.wrangler`). The copy is a recovery aid, not a substitute for checking the current worktree.
- GitHub Desktop previously displayed 71 unpushed commits, but at the canonical repository checkpoint above the active branch matched its upstream and had zero commits ahead. The 71-commit display was not explained by that branch state; recheck the selected repository/branch if the discrepancy appears again.
- **Session-reset checkpoint (2026-11-17):** The last approved implementation commit is `ae1af4a3eab766c56b8607bb39dbe8e79e349e9b` (`Share canonical cabinet rendering with Creator`). Current `HEAD` is `5db00a43f62cb0263e2a9da6a7108998b894c342` (`Add TRG project continuity records`); the intervening/current local Creator title-board work is not approved.
- **Session-reset recovery copy:** `C:\Users\rvsaw\Desktop\TRG-recovery-20261117-reset` contains a full working-tree copy excluding only `.git`, `node_modules`, and `.wrangler`, plus `RECOVERY-TRACKED-CHANGES.patch`, `RECOVERY-STATUS.txt`, `RECOVERY-HEAD.txt`, and `RECOVERY-MANIFEST.txt`.
- **Uncommitted at reset:** Modified `assets/css/creator-dashboard.css`, `creator/index.html`, `docs/PAGE-ARCHITECTURE.md`, `docs/PROJECT-STATE.md`, `scripts/build-store.js`, `scripts/test-storefront-shared-cabinet.js`, and `scripts/test-storefront-visual-alignment.js`; untracked `assets/images/storefront-shelf-dressing/upper-cabinet-creator-desktop.png`, `pnpm-lock.yaml`, `scripts/test-creator-open-rules-data.js`, and `title-card/`.

## Approved and verified

- **Approved visual baseline:** RV approved the Guest and Creator desktop screenshots for the shared cabinet architecture. The cabinet uses the same source composition and frozen artwork as Guest. Do not change approved furniture or deploy without a separate explicit instruction.
- **Committed implementation:** `scripts/build-store.js` provides the shared cabinet renderer and Guest-derived Customer/Creator page paths. `scripts/test-storefront-shared-cabinet.js` checks the shared artwork markup and role boundaries.
- **Recorded architecture rule:** root `AGENTS.md` defines Guest as canonical and prohibits role-specific duplication of shared furniture geometry.
- **Verified checks at the architecture commit:** `node scripts/test-storefront-shared-cabinet.js`, `npm run test:storefront-visual`, and `npm run test:guest-landing` passed.
- No deployment was part of the approval/commit work. This record does not claim the current live site corresponds to these commits.

## Canonized Creator furniture configuration — approved 2026-11-17

- **Implemented:** `scripts/build-store.js` selects Creator-only responsive title-board variants at desktop, tablet, and mobile widths. Guest and Customer generated HTML still use the original shared cabinet assets; the original desktop, tablet, and mobile files remain unchanged.
- **Implemented:** Creator's existing identity overlay places the TRG emblem beside the existing profile logo or gold initials fallback, with the Creator name beneath. Identity continues to come from `assets/js/creator-dashboard-blank.js` and the Creator profile endpoints; no ownership or account data was changed.
- **Visual acceptance:** RV granted acceptance on 2026-11-17. The Creator renderer uses Creator-only responsive cabinet variants, omits the shared central identity sign, and retains the left TRG emblem plus dynamic right-side Creator logo/initials and name overlay. The approved furniture includes the removed plants, right-side bookstops, Open Rules shelf and sign, the Hurricane lantern placement above Duke, the Guest-style framed right-bay poster, its shelf alignment, and the restored overhead light layer.
- **Creator decorative plant removal (2026-11-17):** At RV's direction, Creator-only responsive title-board variants remove both decorative potted plants/pots, and Creator CSS hides the two rotating shelf-dressing slots shown in the supplied crops. The Guest/Customer pages and frozen shared cabinet assets remain unchanged; Duke, the lantern, and the Creator identity overlay remain.
- **Creator lantern placement (2026-11-17):** At RV's direction, the existing Hurricane lantern in each Creator-only responsive title-board variant now sits on the shelf directly above Duke. The Guest/Customer pages and frozen shared cabinet assets remain unchanged.
- **Creator identity scale (2026-11-17):** At RV's direction, the Creator emblem and profile mark/initials presentation is scaled 10% larger in Creator-only CSS. Guest/Customer identity presentation is unchanged.
- **Creator identity composition (2026-11-17):** At RV's direction, the two Creator identity elements are positioned higher on the center board and spaced farther apart through Creator-only CSS. The title-board artwork, cabinet geometry, shelves, Guest, and Customer remain unchanged.
- **Creator identity alignment (2026-11-17):** At RV's direction, the Creator-only overlay now centers the TRG emblem at 25% and the Creator identity at 75% of the board width, with the overlay shifted upward proportionally. Identity sizes and the Creator name treatment remain unchanged.
- **Creator identity balance (2026-11-17):** At RV's direction, both identity groups now share a centered vertical alignment while retaining equal left/right spacing around the board centerline; only their positioning changed.
- **Creator logo vertical alignment (2026-11-17):** At RV's direction, the TRG emblem is vertically centered against the Creator initials group; the Creator initials and name positions remain unchanged.
- **Creator logo midpoint adjustment (2026-11-17):** At RV's direction, only the circular TRG emblem receives an additional 38px upward offset at the current preview resolution; initials, name, size, and horizontal placement remain unchanged.
- **Creator identity group centering (2026-11-17):** At RV's direction, the complete TRG logo/initials/name group receives a 20px leftward horizontal offset at the current preview resolution; vertical positions, spacing, alignment, and sizes remain unchanged.
- **Creator right-side bookstop removal (2026-11-17):** At RV's direction, the right-side library bookstops were removed from the Creator-only responsive cabinet variants. Guest/Customer frozen artwork and shelf layout remain unchanged.
- **Creator Open Rules shelf removal (2026-11-17):** At RV's direction, the horizontal shelf inside the Creator Open Rules Library bay was removed from the Creator-only responsive cabinet variants. Other shelves, cabinet geometry, and Guest/Customer artwork remain unchanged.
- **Creator Open Rules sign removal (2026-11-17):** At RV's direction, the Open Rules Library sign was removed from the Creator-only responsive cabinet variants. The Your Library sign and all other artwork remain unchanged.
- **Creator Open Rules wall-light removal (2026-11-17):** At RV's direction, the bright baked-in wall-light effect in the Creator-only former Open Rules bay is masked with a scoped wood-toned cover. The poster, cabinet geometry, and Guest/Customer pages remain unchanged.
- **Creator Open Rules poster sizing (2026-11-17):** At RV's direction, the existing Guest-style framed-poster treatment is applied to The Familiar poster in the Creator-only right bay; it is centered, enlarged to fill 90% of the full bay height, and aligned above the visible shelf. Other bays and shared cabinet geometry remain unchanged.
- **Creator Open Rules poster lighting (2026-11-17):** At RV's direction, the Creator-only overhead light layer is restored above and across the poster using the cabinet's existing radial downlight treatment. Poster position, size, frame, artwork, shelves, and cabinet geometry remain unchanged.
- **Creator furniture canon:** This approved configuration is the definitive furniture reference for both Creator Profile and Creator Dashboard surfaces. Guest and Customer remain outside this role-scoped furniture exception; the Workshop remains outside scope.
- **Creator Dashboard route:** Permanent Dashboard page is `/creator-dashboard/`; it calls the shared `renderCreatorFurniture()` implementation also used by `/creator/`. The prior `/temp-creator/` route is retired.
- **Outstanding product rotation requirement:** Record/implement automatic 45-second product-cover rotation for the Creator display, with no interaction or configuration controls. This requirement is documented but is not claimed complete by this checkpoint.
- **Local checks passed:** `node scripts/test-creator-open-rules-data.js`, `node scripts/test-storefront-shared-cabinet.js`, and `npm run test:storefront-visual`.
- **HTTP preview check passed:** `http://127.0.0.1:4173/creator/` returns 200; the Creator asset and local identity fixture endpoints return 200. The preview fixture simulates an authenticated RV Sawyer account with no uploaded logo so the initials fallback is exercised. This is not a real authenticated session.
- **Visual status:** Local preview is available at `http://127.0.0.1:4173/creator/`; browser visual acceptance was granted by RV on 2026-11-17. No deployment was made.
- **Checkpoint status:** Approved Creator furniture checkpoint `4d25dd5` (`Canonize approved Creator furniture`). Preserved unrelated untracked work remains outside that checkpoint.

## Unfinished work

- Automatic 45-second product-cover rotation for the Creator display remains outstanding; it must run without interaction or configuration controls.
- The untracked Creator test and other listed untracked work must be preserved until separately reviewed; do not include them in unrelated commits.

## Proposed or not authorized by this record

- Deployment remains unauthorized for this checkpoint.
- Any artwork/furniture alteration, Guest/Customer visual change, deployment, production data operation, or unrelated refactor needs its own explicit authorization. This document grants none.
