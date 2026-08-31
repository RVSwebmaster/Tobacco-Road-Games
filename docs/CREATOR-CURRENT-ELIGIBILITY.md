# Creator current operational eligibility

Current Creator authorization is distinct from historical registration completion. `intake_registration_completed_at` records that onboarding succeeded once; it is immutable history and is never sufficient by itself to authorize a protected operation.

## Central predicate

`getCreatorOperationalEligibility` in `functions/_lib/creator-registration.mjs` evaluates current database state on each protected request. It requires the settled registration conditions: an active verified customer account with valid identity data, complete public and private Creator registration, the current Creator Agreement, a ready marketplace payment method, complete and payout-enabled Stripe Connect status, an active identity entitlement (including current billing for an additional identity), an operational Creator account state, and no audit restriction.

The result includes `eligible`, safe reason codes, remediation destinations, the current evaluation time, and historical-completion state. It does not expose fraud or risk internals. The existing `cure_required` audit state remains operational during the settled cure window; `restricted` blocks protected operations.

## Protected surfaces reviewed

The current predicate is enforced server-side for:

- listing creation, editing, submission, reactivation, pricing changes, and bundle creation;
- private Creator file uploads and Free, PWYW, and paid publication readiness;
- advertising mutations and Ad Credit purchases;
- Creator Balance product/service spending, including Preferred purchases;
- payout requests.

Creator dashboard state is advisory only. Direct API requests pass through the same server checks. Creator membership, including editor/staff membership, cannot override creator-wide ineligibility.

## Access retained during remediation

An ineligible Creator remains a Creator. Authenticated members can view the dashboard, listing history, analytics, finance statements/reports, balances, audit/remediation status, and profile state. They can correct the public profile, accept the current Agreement through account registration, repair the hosted payment-method state, continue Stripe Connect remediation, submit remediation corrections, and pause a listing. New intake, uploads, publication, advertising/service spending, and payout requests remain blocked until current eligibility is restored.

Historical Agreement acceptances are preserved when superseded. Restoring every current requirement restores operational access without rewriting the original completion timestamp.

## Data preservation and unresolved policy

Eligibility loss does not delete or confiscate Creator identity, listings, historical sales, customer entitlements, delivery access, ledger entries, balances, payout history, agreement history, or audit history. Existing financial hold and reservation rules continue to apply.

The settled policy does not currently require an automatic takedown of already-published listings for every general eligibility lapse. This repair therefore blocks new or changed selling operations without inventing a new takedown rule. Audit-specific restriction and existing publication/inactivity/remediation systems continue to govern their established cases. A broader automatic existing-listing sales rule remains an owner policy decision if desired.
