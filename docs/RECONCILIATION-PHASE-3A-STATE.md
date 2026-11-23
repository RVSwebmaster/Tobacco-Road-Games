# Historical snapshot: Phase 3A reconciliation state

This records the classification and source state at Phase 3A on 2026-11-23. It is superseded by [the Phase 6 reconciliation closeout](RECONCILIATION-CLOSEOUT-2026-11-23.md); current branch and deployment state must be read from Git refs and Cloudflare metadata.

Date: 2026-11-23. Source baseline: corrected `main` at `1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6`. Old `development` remains preserved at `e796fd8fd8b4aad8eeb61f284eec0d029b2552a6`.

## Bring forward now — Category 1

- **Creator Dashboard route and shared furniture:** `/creator-dashboard/` is canonical; `templates/creator-dashboard.html` uses the accepted shared cabinet renderer. `/temp-creator/` redirects to the canonical route. The existing Dashboard runtime and PDF draft-persistence validation are preserved. The focused PDF test now targets the canonical route.
- **Release pipeline:** preserve the immutable Git-archive build, exact-SHA gate, environment/resource validation, migration receipts, Owner Preview approval record, staging attestation, rollback reference, and deployed-release checks under `ops/release/`, `ops/releases/`, and `scripts/release-pipeline.mjs`.
- **Profile support:** keep focused access/library/shared-cabinet/Profile regression tests for the six existing shared-renderer routes and approved furniture. Main's accepted Profile implementation is not rebuilt or replaced.

## Future/deferred — Category 2

The following implementation and focused tests are retained for development and later release work, not deployed or migrated in Phase 3A:

- Financial accounting, commission snapshots/reconciliation, order fee handling, and Owner finance/order reporting: related `functions/_lib/` and `owner/` source plus the focused Stripe/Creator-earnings/fulfillment tests. These additions depend on their own release and migration review.
- Creator capacity and Founding-25 allocation administration: `functions/_lib/founding25-owner.mjs`, `functions/owner/api/founding25.js`, `assets/js/owner-founding25.js`, migration 077 and focused privilege tests.
- R4 rate-limit cleanup/index: migration 078 and its historical test/report remain on the preserved old-development ref; active `account-auth.mjs` is deliberately left at the production baseline so this reconstruction does not silently alter authentication behavior.
- Email-dependent password recovery remains separate from normal registration/login and is not an activation requirement for this phase.

No new feature gate was invented. The reconciliation candidate is not deployed; schema-dependent work stays behind its existing schema/migration boundary and normal release review.

## Shelved, not activated — Category 3

- D1-managed Open Rules upper/lower shelf split and migration 073.
- Saved-card/payment-method flow and migration 079.
- Creator catalog-cover rotation as default behavior; the production baseline's default-off guard remains intact.
- Stripe Express/CSV sandbox and SMTP transport prototype.

The old-development ref preserves excluded source history. Useful migration files remain in this branch without being applied or used to activate a feature.

## Excluded — Category 4

No Google sign-in, email-verification gate for ordinary login, email-provider requirement for ordinary registration/login, rejected account-page presentation, superseded Customer/Guest navigation, undefined bare `openRules` binding, or staging logout redirect to production is restored.

## Documentation and verification boundary

Current continuity is in `SITE-GEOGRAPHY.md`, `PAGE-ARCHITECTURE.md`, `MEMBER-ACCOUNT-ARCHITECTURE.md`, and `PROJECT-STATE.md`. Historical release evidence is retained in `ops/releases/records/auth-no-email-2026-11-22.json` and the focused account/Profile recipe. No deployment, migration, production/staging write, or change to the canonical `development` ref is part of Phase 3A.
