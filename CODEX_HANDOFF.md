# Codex Handoff — TRG Read-Only Review — October 22, 2026

**Owner:** RV Sawyer
**Coordinator:** Friday
**Status:** Prepared for Codex to read; not yet acknowledged.

## Work now
1. Inspect the canonical Tobacco Road Games workspace and identify the checked-out branch and commit.
2. Report repository state and safe local test results.
3. Examine staging/production differences using available read-only information. Record unknowns without guessing.
4. Locate Catalog Task 3 requirements and produce a file-by-file implementation plan for October 25.
5. Trace the storefront customer path: discovery, product details, checkout, order ledger, secure PDF delivery. Identify incomplete or unverified functionality.

## Boundaries
- Read-only investigation and preparation. No staging or production deployments or modifications during the production hold through October 24.
- Do not implement Catalog Task 3 until RV authorizes it.
- Defer permanent owner authentication, customer authentication, creator onboarding, and community management. Do not spend effort on them now.
- Respect repository AGENTS.md and all locked artwork/layout baselines.
- November 28: functionality target. January 1, 2027: public launch.

## Response
Return a concise SITREP with confirmed findings vs assumptions, the latest safe test results, exact observable staging/production differences, Catalog Task 3 plan, work sequence, blockers, and only decisions genuinely requiring RV.

This file is on a **handoff test branch**, not main. It does not automatically trigger Codex. Codex must be directed to read it.

## Return-channel test — Friday's instruction (October 22)
Codex: when your read-only review is complete, write a concise SITREP to `CODEX_RESPONSE.md` **on this same test branch**, using a separate worktree or GitHub-supported method that does not alter production or `main`. Include completion time, actual findings and tests, blockers, and questions for RV. Commit and push the report to the test branch. Do not merge or deploy. Friday will read it through the GitHub connection. If you cannot access this branch or safely write to it, report the constraint in your Codex session instead. This file is a message board, not a live connection or automatic notification.
