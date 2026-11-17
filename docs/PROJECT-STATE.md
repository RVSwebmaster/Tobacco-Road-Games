# TRG project state

Last reconciled: 2026-11-17. This is a working-state record, not a deployment status page.

## Source-control checkpoint

- Canonical repository: `C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games`.
- Active development branch: `codex/operation-severance-task1`.
- Documentation baseline at the start of this continuity update: `c03c60eebcf026d724d87c67b9bca71e9d9aec55`, synchronized with `origin/codex/operation-severance-task1`.
- The preceding approved-architecture commits are `ae1af4a` (shared cabinet rendering) and `c03c60e` (separate Creator identity follow-up note).
- At that checkpoint, the worktree contained only these untracked items: `pnpm-lock.yaml`, `scripts/test-creator-open-rules-data.js`, and `title-card/`. They were intentionally excluded from the architecture commits and preserved in the external recovery copy below. Recheck Git before relying on this snapshot.
- Recovery copy: `C:\Users\rvsaw\Desktop\TRG-continuity-20261117-1794935441194`. Its tracked-change patch passed `git apply --reverse --check`; copied entries matched the recorded hashes at verification. The copy is a recovery aid, not a substitute for checking the current worktree.
- GitHub Desktop previously displayed 71 unpushed commits, but at the canonical repository checkpoint above the active branch matched its upstream and had zero commits ahead. The 71-commit display was not explained by that branch state; recheck the selected repository/branch if the discrepancy appears again.

## Approved and verified

- **Approved visual baseline:** RV approved the Guest and Creator desktop screenshots for the shared cabinet architecture. The cabinet uses the same source composition and frozen artwork as Guest. Do not change approved furniture or deploy without a separate explicit instruction.
- **Committed implementation:** `scripts/build-store.js` provides the shared cabinet renderer and Guest-derived Customer/Creator page paths. `scripts/test-storefront-shared-cabinet.js` checks the shared artwork markup and role boundaries.
- **Recorded architecture rule:** root `AGENTS.md` defines Guest as canonical and prohibits role-specific duplication of shared furniture geometry.
- **Verified checks at the architecture commit:** `node scripts/test-storefront-shared-cabinet.js`, `npm run test:storefront-visual`, and `npm run test:guest-landing` passed.
- No deployment was part of the approval/commit work. This record does not claim the current live site corresponds to these commits.

## Unfinished work

- **Creator identity visual defect:** the Creator identity overlay can overlap the TRG medallion baked into the shared cabinet art. The furniture is approved; the identity presentation is not. See [creator-identity-follow-up.md](creator-identity-follow-up.md).
- **Creator identity test:** the local `scripts/test-creator-open-rules-data.js` fails at line 104 because it forbids `.creator-dashboard-identity-overlay`, which the generated page currently contains. The failing expectation has not been waived. A real authenticated-session visual check also remains unverified.
- The untracked Creator test and other listed untracked work must be preserved until separately reviewed; do not include them in unrelated commits.

## Proposed or not authorized by this record

- Fixing the Creator identity overlap is future work, not part of the approved furniture baseline.
- Any artwork/furniture alteration, Guest/Customer visual change, deployment, production data operation, or unrelated refactor needs its own explicit authorization. This document grants none.
