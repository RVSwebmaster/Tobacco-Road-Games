# Tobacco Road Games November 28 Functional-Completion Punch List

Date prepared: 2026-10-16

Schedule reviewed: 2026-10-17

Source audit: `TRG-FINAL-LAUNCH-AUDIT-2026-10-16.md`

Status: controlling completion plan; individual implementation packages still require RV authorization

## Decision boundary

The controlling schedule is:

- **November 28, 2026:** the entire marketplace is functionally complete, including Customer, Creator, and Owner operations.
- **December 2026:** Creator recruitment, onboarding, catalog preparation, and launch marketing use the completed marketplace.
- **January 1, 2027:** the public marketplace launches.

No functional marketplace capability is intentionally deferred beyond November 28. December is an operational adoption and launch-preparation month, not a continuation of core marketplace implementation. Production and staging remain `CLOSED` except for separately authorized, controlled rehearsal windows.

Approved storefront artwork, shelf geometry, locked botanical assets, Duke, upper-cabinet composite, book interaction, sponsor placement, and other AGENTS.md design locks are out of scope and must remain unchanged.

## P0 — before the next staging deployment or rehearsal

### 1. Confirm and enforce the completion boundary

- **Outcome:** Customer, Creator, and Owner marketplace operations are functionally complete by November 28 without opening the public marketplace early.
- **Work:** Complete and verify every functional workflow in isolated staging while production remains closed. Preserve existing accounts, Creator records, dashboards, and history.
- **Acceptance:** The complete Customer, Creator, and Owner workflow matrix is implemented and rehearsable before December recruitment begins; incomplete or placeholder contractual/provider paths are not exposed as ready.
- **Why now:** December onboarding and catalog preparation depend on the completed Creator and Owner operations, not only the customer storefront.

### 2. Restore a real staging launch catalog through the canonical pipeline

- **Outcome:** At least one exact intended November product is browsable, quotable, fulfillable, and downloadable in isolated staging.
- **Work:** Use real approved metadata and temporary/staging-safe product objects. Do not resurrect all 12 legacy D1 seeds. Populate `data/products.json`, the generated runtime catalog/folder map, product pages, and `trg-products-staging` only through the approved intake/publication process.
- **Acceptance:** Static source, D1 listing/publication state, R2 object keys, product page, quote, fulfillment mapping, and hashes agree. Production `trg-products` is unchanged.
- **Dependency:** staging publication configuration in item 3.

### 3. Complete isolated staging configuration

- Add a unique staging `ORDER_ACCESS_SIGNING_SECRET`.
- Configure an intended staging owner-auth path.
- Add staging-only GitHub dispatch authorization and set `GITHUB_PUBLISH_REF=staging`; never allow staging to default to `main`.
- Add `RESEND_WEBHOOK_SECRET` if delivery-state reconciliation is in rehearsal scope.
- Preserve `PAYMENT_PIPELINE_STAGE=staging`, test-only Stripe keys, staging D1/R2 bindings, and the isolated Pages project.
- **Acceptance:** owner login/control works; publication writes only staging R2 and staging branch; generated output reaches the isolated staging project; a paid test order creates and sends a secure order-access message; no production resource changes.

### 4. Restore a green release test gate

- Replace retired `agency`/generated-page assumptions with explicit test-local catalog and delivery mappings.
- Update the marketplace/bundle fixtures to create their own public products.
- Update obsolete storefront markup/cache-bust assertions without changing approved visuals.
- Make the migration-050 closure-time test deterministic without weakening database-authoritative time.
- **Acceptance:** all 69 current individual tests pass; `npm test` completes; focused finance, payout, refund, delivery, review-hold, owner maintenance, registration, store-state, storefront, and sponsor suites pass; `git diff --check` passes.
- **Status:** Complete at code checkpoint `4f74cf4d313172de8d2f1d9325450b868eb3da11`; keep this gate green through November 28.

### 5. Reassert controlled store-state operations

- Keep production `CLOSED` before and during any live catalog object, publish commit, or live Stripe configuration work.
- Keep staging `CLOSED` outside explicit rehearsal windows.
- Do not blindly apply `052_open_store_state.sql` to staging.
- Update the runbook so opening is an authenticated owner action after closed-state verification, never an incidental migration side effect.
- **Acceptance:** deployment/publication while closed cannot sell; owner audit records the eventual deliberate open action; emergency close is rehearsed.

## P1 — complete before November 28 functional sign-off

### 6. Configure and verify production customer payments

- Set `PAYMENT_PIPELINE_STAGE=production`.
- Install production `STRIPE_SECRET_KEY` and endpoint-specific `STRIPE_WEBHOOK_SECRET` without exposing values.
- Register the production webhook endpoint and required event types.
- Verify idempotency, canceled/expired/failed states, delayed/retried webhooks, and reconciliation while store remains closed.
- **Acceptance:** a separately authorized minimal live transaction reaches one paid order, one entitlement, one financial allocation, and one delivery path; duplicate webhook delivery changes nothing.

### 7. Configure production transactional email and account verification

- Install `RESEND_API_KEY`, `RESEND_REPLY_TO`, and `RESEND_WEBHOOK_SECRET`.
- Deliberately enable order delivery with `RESEND_DELIVERY_ENABLED=true` only after sender/domain verification.
- Verify account verification, resend, password reset, guest verification, order delivery, intentional resend, delivered/delayed/bounced/suppressed updates, and support reply routing.
- **Acceptance:** no promotional subscription is created by registration, purchase, follow, or ordinary email submission.

### 8. Complete public customer legal and support surfaces

- Obtain owner/counsel-approved Terms of Sale, Privacy Notice, and refund/digital-delivery policy.
- Add a visible independent support contact route that works even when delivery email fails.
- Link the approved notices at account creation, checkout, and footer/support locations as counsel directs.
- **Acceptance:** a new customer can understand data use, purchase/delivery/refund rules, and how to reach support before paying.

### 9. Restore settled marketplace philosophy and public naming

- Remove the standalone AI-specific public section and its navigation links; do not replace it with another AI-specific statement.
- Preserve the broader production-method-neutral marketplace principle.
- Restore the exact approved quotation and `— RV Sawyer` attribution in the appropriate general philosophy presentation.
- Replace public `TRG UPDATE` shorthand with `Tobacco Road Games` language.
- **Acceptance:** no customer- or Creator-facing `TRG` shorthand remains; no public AI disclosure/purity section exists; the quote matches the approved text exactly.

### 10. Configure the publicly linked forum or hold its write surface

- Add a unique production `FORUM_RATE_LIMIT_SECRET` if Community Forum posting is in the January launch scope.
- Verify account/email gates, profile privacy, topic/reply/report limits, moderation, and avatar binding.
- If the forum is not in scope, do not advertise an unusable write path as live.
- **Acceptance:** reachable forum actions do not fail because configuration is missing.

### 11. Run and sign off the full isolated staging launch rehearsal

- Execute the ordered customer and owner script in the audit report.
- Record order IDs, provider event IDs, entitlement IDs, object keys/hashes, mail IDs, expected audit rows, and store-state transitions.
- Run and sign off the complete Creator workflow section; it is part of the November 28 functional-completion boundary.
- **Acceptance:** no direct SQL fabrication of provider success, no production data, no production bucket writes, and all acceptance evidence retained.

### 12. Capture launch recovery and rollback evidence

- Export production D1 before catalog/config activation.
- Record production R2 inventory and exact launch object checksums after upload.
- Confirm Cloudflare recovery/PITR availability and responsible operator.
- Rehearse `CLOSED` emergency action and distinguish code rollback from immutable customer/order preservation.
- **Acceptance:** RV has a short, verified incident checklist and downloadable pre-open evidence.

### 13. Prepare catalog/config while CLOSED for the January 1 launch

- Freeze the approved commit and review the exact delta to main.
- Production currently has all 53 repository migrations; do not reapply them. Review only newly introduced migrations, if any.
- Publish exact launch catalog/assets while `CLOSED`; deploy; run production closed-state smoke tests.
- Conduct any live-payment test only under separate explicit approval.
- Keep the store closed after promotion and closed-state verification. Opening remains a separate, explicit January 1 authorization through the authenticated Owner control.
- **Acceptance:** production commit, D1 state, R2 manifest, Stripe mode, webhook, email, Owner access, browse, checkout, entitlement, and support all match the release record while the marketplace remains closed and ready for the authorized January 1 opening.

## P2 — Creator and marketplace operations required by November 28

Every item in this section is part of functional marketplace completion. None is intentionally deferred to December or beyond.

### Legal and policy readiness

- Counsel-final Creator Agreement; remove placeholder acceptance language.
- Final Creator privacy/retention, IP complaint, termination, negative-balance, and entitlement-survival procedures.
- Confirm no AI disclosure requirement is introduced.

### Provider and money movement

- Production Stripe Connect configuration and approved onboarding path.
- Production payment-method collection for Creator services.
- External payout execution with exact reservation/completion linkage and reconciliation.
- Live refund/dispute execution and provider-cost handling.
- Monitoring, retry, incident, and operator approval runbooks.

### Lifecycle automation and communications

- Production schedule for account audits, inactivity, remediation deadlines, Preferred installments, discovery recalculation, and other time-based work.
- Marketplace notice delivery worker with dedupe, failure monitoring, and dashboard authority.

### Creator product operations

- File malware/safety process beyond type-signature validation.
- Full publication/pause/rebuild deployment rehearsal.
- Creator sales/analytics/earnings/payout rehearsal.
- Preferred external activation, monthly/annual renewal, Creator Balance, Ad Credits, and additional identities.
- Review Hold remediation, canonical file replacement, refunds/disputes, and closure rehearsal.

### Advertising rollout

- Stronger event/reporting abuse controls before paid external sponsor metrics are contractual.
- Advertiser operations, approval, reconciliation, and support procedures.

## Non-functional hardening debt that may follow functional completion

Only non-functional hardening, documentation refinement, and optional presentation improvements may remain after November 28. Anything required for a Customer, Creator, or Owner marketplace operation belongs in P0–P2 and must not be reclassified into this section to meet the date.

- Registration/email provider failure compensation or outbox semantics.
- Publication orphan-object cleanup/retry runbook.
- Unique migration numbering after the duplicate 048 pair.
- Documentation refresh for store state, R2 routing, and superseded audits.
- Failed Git preview-deployment diagnosis.
- Expanded automated accessibility checks and general customer order history.
- Tier 3 storefront visual work only after functional and operational readiness.

## Do not do during repairs without separate authorization

- Do not redesign or replace any AGENTS.md-locked storefront asset or behavior.
- Do not push or deploy `main` merely to test a repair.
- Do not open production as part of deployment.
- Do not apply migration 052 to staging casually.
- Do not copy production secrets or data into staging.
- Do not fabricate Stripe/webhook success or alter orders directly.
- Do not delete legacy D1 records or bucket objects as cleanup.
- Do not open the public marketplace merely because Creator operations are being completed or December onboarding begins.

## Authorization checkpoint

The repository-finalization checkpoint through commit `4f74cf4d313172de8d2f1d9325450b868eb3da11` is complete. Each remaining implementation, configuration, rehearsal, push, or deployment package still requires RV authorization. Work remains isolated on `staging`; neither store may be opened as a side effect of completing this plan.
