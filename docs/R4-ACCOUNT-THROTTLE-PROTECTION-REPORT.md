# TRG Launch Acceleration — R4 Account Throttle Protection

**Status:** Implemented locally; isolated verification passed. Production migration and deployment were not performed.  
**Date:** 2026-11-18  
**Scope:** Atomic account rate-limit accounting, bounded expired-record cleanup, focused regression coverage, continuity updates, and the Owner’s R3 deferral.

## Summary

R4 replaces the account authentication throttle’s select-then-write counter sequence with atomic SQLite UPSERT counters and now enforces three independent dimensions: the original combined action/IP/identity key, account identity, and source network. Changing either the email/account identity or source IP alone cannot bypass the applicable independent limit. Expired throttle records are deleted in batches limited to 100 rows per checked request.

Existing account authentication, account identity, hashed throttle keys, action thresholds, and one-hour fixed windows are preserved. No authentication system, external rate-limit service, or dependency was added.

## Implementation

### Atomic fixed-window counter

`functions/_lib/account-auth.mjs::allowRateLimit()` previously read `attempt_count` and `window_started_at`, then conditionally inserted or incremented in a later database write. Concurrent requests could read the same pre-increment count and each be admitted.

The updated function performs `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` for each enabled key dimension. On an existing row, SQLite either increments its count or resets the count and start time if the fixed window has expired. The returned counts are compared with their dimension's limits. Existing combined-key thresholds and key derivation are unchanged; additional identity and network counters use separate action-scoped hashes in the same D1 table.

Unchanged one-hour window limits:

| Action | Allowed attempts per fixed window |
| --- | ---: |
| Google sign-in | 20 |
| Password login | 10 |
| Password reset | 6 |
| Registration | 6 |
| Email verification | 8 |

### Independent limits

The following independent ceilings are implemented as one-hour fixed windows. These are recommended starting operational limits and do not change the existing combined thresholds.

| Action | Account identity | Source network |
| --- | ---: | ---: |
| Google sign-in | 100 verified-subject attempts | 1,200 |
| Password login | 100 failed credential attempts | 600 failed credential attempts |
| Password reset request | 20 per submitted email | 300 |
| Registration | 20 per submitted email | 300 |
| Email verification | 20 per presented token | 300 |

Network ceilings are intentionally much higher than the per-key limits to allow multiple people behind shared home, office, campus, or carrier addresses. The initial recommendation is 600 password login attempts per network per hour (ten per minute), 1,200 Google attempts, and 300 per hour for lower-volume email actions. Revisit these ceilings against observed traffic after TRG is operational; no production telemetry was accessed for this implementation.

Both password-login independent buckets count failed credentials only. A valid password remains accepted even when either failure bucket is saturated, preventing an attacker from locking a legitimate user out by exhausting account or shared-network capacity. Valid logins still consume the original combined action/IP/identity key, preserving its existing threshold. Google account throttling uses a verified provider subject, never an unverified JWT claim. Registration and password-reset identity buckets use normalized submitted email; verification uses the presented token. All stored keys are hashes.

### Bounded expired-record cleanup

Each checked attempt deletes at most 100 rows whose fixed-window start is older than the one-hour expiry cutoff. `migrations/078_auth_rate_limit_cleanup_index.sql` adds an index on `auth_rate_limits.window_started_at`; the cleanup selects oldest expired keys first. Repeated requests gradually clear larger backlogs without running an unbounded table delete in one request.

The new migration is additive and does not rewrite throttle rows. It must be included in the normal database migration process before this code is deployed; it was not applied to a production or remote database.

## Regression tests

`scripts/test-account-auth.js` now runs `testAtomicRateLimitConcurrencyAndExpiry()` against isolated in-memory SQLite with the local D1 adapter.

- **Combined-key concurrency:** 40 simultaneous password-login attempts resulted in exactly 10 passing the existing combined threshold and 30 receiving HTTP 429. The combined counter recorded all 40 attempts.
- **Account identity independence:** 101 failed login attempts for one account, each from a different source IP, reached the 100-failure identity limit. A correct password then succeeded despite the saturated failure bucket, preventing account lockout.
- **Source network independence/shared-network allowance:** 601 failed login attempts with distinct email identities from one source IP resulted in 600 requests passing the network bucket and the 601st receiving HTTP 429. A correctly authenticated account then succeeded from that saturated network, demonstrating that the broad failure bucket does not lock out its legitimate users.
- **Verified Google identity:** 101 valid test credentials with one verified provider subject across distinct IPs resulted in 100 successful sign-ins and one HTTP 429.
- **Restriction expiry:** A valid account was throttled after the existing ten-attempt combined password-login limit. A valid login after the one-hour window returned HTTP 200, and the combined counter restarted at one.
- **Bounded cleanup:** With 250 expired records seeded, one checked request removed exactly 100 and retained the other 150 expired rows plus three active-dimension counters. The test also confirms the cleanup index exists.
- **Existing policy regression:** The account-auth suite’s existing registration throttle test still passes at its current six-attempt threshold.

Focused command:

```text
node scripts/test-account-auth.js
Shared account auth tests passed.
```

## Launch verification

`npm run verify:launch` was run against isolated resources after implementation and continuity updates.

| Result | Count |
| --- | ---: |
| Passed | 71 |
| Failed | 0 |
| Skipped | 0 |
| Blocked | 1 |

The launch-critical result is **PASS**. The blocked check is `test:creator-native-submission-staging`, which requires remote staging D1/R2 and Wrangler configuration and was not run against production. The separate storefront visual check and Owner-intake Chromium check both passed. Full run details and working-tree snapshot are in `docs/LAUNCH-VERIFICATION-RESULT.json`.

## Continuity updates

- `docs/PROJECT-STATE.md` records the R4 implementation, tests, rollout boundary, and the Owner’s R3 decision.
- `docs/ENGINEERING-FORENSICS-LEDGER.md` records the work and verification evidence.
- `docs/ACCOUNT-AUTH-FOUNDATION.md` documents atomic counting and bounded cleanup.
- `C:/Users/rvsaw/Desktop/Dr DM Workshop/TRG-Engineering-Forensics-001/TRG-LAUNCH-ACCELERATION-QUEUE.md` records R4 as implemented locally and R3 advertising metrics protection as deferred until TRG is operational. Other completed queue items are cross-referenced to current project continuity records.

## Remaining boundaries

- The migration has not been applied to staging or production. Production rollout requires its separately authorized migration/deployment process.
- Verification uses local SQLite through the D1-shaped test adapter; it does not query or mutate Cloudflare D1.
- The failed-login identity and network ceilings avoid lockout for a user with the correct password, but still perform password verification for each failed attempt. The original combined-key threshold remains the request-volume limit for one account/IP pair.
- Repeated registration, reset, or verification attempts can temporarily throttle the submitted email/token identity. These identity ceilings are intentionally above their existing combined-key limits. Source-network ceilings can still affect unusually high-volume shared networks and should be revisited only with operational traffic evidence.
- R3 advertising metrics protection remains deferred by Owner decision and was not changed in this assignment.
- No production access, deployment, live financial operation, new dependency, external service, or commit occurred.
