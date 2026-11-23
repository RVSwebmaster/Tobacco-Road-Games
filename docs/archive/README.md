# Archived TRG material

These dated files preserve prior investigations and incomplete prototypes. They are historical references, not current release instructions or active application code. The current project state is documented in [`PROJECT-STATE.md`](../PROJECT-STATE.md), and release procedures are in [`ops/release/README.md`](../../ops/release/README.md).

## Production recovery snapshot

[`PRODUCTION-STATE-RECOVERY-2026-11-22.md`](recovery/2026-11-22/PRODUCTION-STATE-RECOVERY-2026-11-22.md) records the production and Git state observed before the later release. It is retained as a dated recovery artifact; the current production deployment and source are recorded in the release record referenced by the project state.

## Site build audit

[`SITE-BUILD-AUDIT-2026-11-21.md`](audits/2026-11-21/SITE-BUILD-AUDIT-2026-11-21.md) is a point-in-time audit. Its findings predate the current account release and must not be treated as the current readiness status.

## Unintegrated account SMTP prototype

The files in [`prototypes/account-email-smtp-2026-11-22/`](prototypes/account-email-smtp-2026-11-22/) preserve the Gmail SMTP transport and its fake-socket unit test from the requested provider investigation. They were not integrated into `functions/_lib/account-auth.mjs`, which still uses the tracked Resend provider for account mail. The test is not registered in `package.json`, and its fake SMTP responses do not demonstrate real delivery. The prototype therefore is not approved current application code and must not be copied into the runtime path without a fresh implementation and delivery review.

The Pages builder copies only its explicit root-file and public-directory allowlists; `docs/` is not included in the generated Pages artifact.
