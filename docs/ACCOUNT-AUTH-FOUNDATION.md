# Shared Account Foundation

This document records the shared Tobacco Road Games account foundation for Cloudflare Pages Functions.

## Scope

The account system supports:

- native email/password registration and sign-in;
- email verification;
- password reset;
- Google Identity Services sign-in;
- TRG-owned session cookies shared by native and Google accounts;
- `/api/account/me` for the current signed-in account state.

The account foundation does not change Stripe checkout, secure downloads, order lookup, Office authentication, Cloudflare Access, owner controls, store purchasing, or forum behavior. Forum handles and public profile names are deliberately outside the credential tables.

## D1 migration

Apply `migrations/007_shared_accounts.sql` to the existing `TRG_ORDERS` D1 database binding.

The migration creates:

- `users`
- `user_identities`
- `password_credentials`
- `sessions`
- `email_verification_tokens`
- `password_reset_tokens`
- `auth_rate_limits`

Native and Google identities both resolve to `users.id`. Password hashes, Google provider subjects, session tokens, verification tokens, and reset tokens are stored separately. Session, verification, and reset tokens are stored only as hashes.

## Environment variables

Required for Google sign-in:

- `GOOGLE_CLIENT_ID`

Required for account email delivery through the existing shared Resend provider:

- `RESEND_API_KEY`
- `RESEND_REPLY_TO`

The outgoing From address is not configured by this account system. It comes from the existing shared store email provider as `Tobacco Road Games <orders@tobaccoroadgames.com>`. `RESEND_REPLY_TO` is the confirmed support mailbox used for replies and is already the standard store email variable. `RESEND_FROM_EMAIL` is not used by the shared account system.

Email verification and password reset requests fail closed with a server-side email-provider configuration error until both `RESEND_API_KEY` and `RESEND_REPLY_TO` are present and valid.

## Google Identity Services configuration

Create or use an OAuth client for the Tobacco Road Games website and configure its authorized JavaScript origins.

Production origin:

- `https://tobaccoroadgames.com`

Local development origins may include:

- `http://127.0.0.1:8788`
- `http://localhost:8788`

The browser sends the Google credential to `/api/auth/google`. The server verifies the credential signature, issuer, audience, expiration, Google subject, and `email_verified` claim. The Google identity uses the `sub` claim, not the email address, as the provider identity.

Google popup sign-in uses the existing TRG same-origin protection: the `trg_account_csrf` cookie, matching `x-csrf-token` header, and `Origin`/`Referer` validation.

## Session behavior

Successful native or Google sign-in creates a TRG session in the `sessions` table and returns:

- `__Host-trg_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- `trg_account_csrf`: `Secure`, `SameSite=Lax`, `Path=/`

The session token is random and stored only as a SHA-256 hash. The CSRF token is also stored as a hash. State-changing authenticated account actions require the CSRF token.

Sign out revokes the current session and clears both cookies.

## Native password behavior

Passwords are hashed with Workers-compatible scrypt using `@noble/hashes`. The stored password format includes the scrypt parameters, salt, and derived key. Plain text passwords are never stored.

Password reset links are random, single-use, time-limited tokens stored only as hashes. Password reset request responses are intentionally generic so they do not reveal whether an email exists.

## Account throttling

Registration, password login, Google login, email verification, and password-reset requests retain their existing per-action thresholds and one-hour fixed windows in `functions/_lib/account-auth.mjs`. Atomic SQLite UPSERT/`RETURNING` counters independently enforce the original action/IP/identity key, account identity, and source network, so changing either identity or IP does not bypass the broader bucket. The additional recommended identity/network ceilings are recorded in `docs/R4-ACCOUNT-THROTTLE-PROTECTION-REPORT.md`. Password-login identity and network buckets count failed credentials only; a valid password is accepted even if either failure counter is saturated. Google identity is taken only from a verified provider subject. Expired `auth_rate_limits` rows are pruned in batches of at most 100 per checked request; migration `078_auth_rate_limit_cleanup_index.sql` indexes the window timestamp for that cleanup. No authentication provider, account identity, or rate-limit service is added.

## Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/logout`
- `GET /api/account/me`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`

## Local and staging notes

For local Pages development, bind the same D1 database shape and set the local Google origin in the OAuth client. Use test Resend values only if testing live delivery is intended.

For staging, add the staging Pages origin to the same Google OAuth client or use a separate staging client ID. Keep the staging `GOOGLE_CLIENT_ID` aligned with that origin.

Staging account email requires the same Resend variables used by store delivery:

- `RESEND_API_KEY`: encrypted Resend API key, installed as a Pages secret.
- `RESEND_REPLY_TO`: confirmed support mailbox for replies, installed as a Pages secret.

The staging helper `ops/staging/configure-resend.ps1` installs those names without printing their values. It also installs Resend webhook and order-access secrets used by store delivery.

The account page is `account.html`. Google sign-in is presented as one option beside native sign-in and registration; it is not required.

## Settled account-policy target

The credential foundation is narrower than the settled customer-account policy. A normal customer account may additionally contain a real/legal name, optional shipping addresses, optional birthday, optional public display/profile name and avatar, notification preferences, order history, My Library entitlements, and only safe Stripe references for saved payment methods. Guest checkout remains available. Native and Google authentication continue to resolve to the same ordinary customer identity.

Seller registration upgrades that ordinary customer identity into a Creator relationship; it does not create a separate authentication system and is not an artistic or merit-based application. One seller registration includes one free primary Creator identity. Genuinely separate additional Creator identities cost $10 monthly or $100 annually each, with any Preferred fee added separately. This prevents aliases from multiplying free account-level benefits.

Every Creator identity must maintain a valid Stripe-hosted payment method. Creator registration must be fully complete, including Connect payout readiness, before product intake or listing tools become available. This applies to drafts and to paid, Free, and PWYW products. Stripe remains authoritative for card, bank, identity, KYC, and tax data; TRG stores only opaque references and safe display metadata.

## Customer registration and saved cards — implemented locally 2026-11-18

- Customer registration continues to use the shared `users`, password credential, session, and email-verification infrastructure. New email/password and first-time Google registrations receive a pending row in `customer_registration_states`; the constrained `users.role` values are unchanged. Pending accounts do not receive Customer library access. Existing accounts without a pending-registration row retain their current privileges.
- Customer activation requires verified email, required profile and billing fields, recorded Terms/Privacy consent, and at least one successfully confirmed card. Activation updates the registration state in place. Creator/Admin/Owner elevation retains the same active Customer profile and library.
- Card collection uses Stripe.js Payment Element with a server-created SetupIntent. PAN, expiry entry, and CVC stay inside Stripe Elements; TRG receives only the SetupIntent ID and, after server verification, stores the PaymentMethod reference, cardholder name, brand, last four, and expiry. Setup uses `usage=on_session`; registration does not create a charge or fee. The customer gives explicit card-save consent for each setup attempt.
- `migrations/079_customer_signup_and_saved_cards.sql` adds billing profile fields, versioned consent records, setup attempt records, saved-card records, and a migration of existing safe default-card references. Unknown historical card expiry is left NULL and may be hydrated from Stripe when the authenticated account opens card management; the migration does not invent expiration data.
- Customer profile changes and saved-card actions are authenticated and CSRF-protected. Card list/default/remove actions are account-scoped. The My Library endpoint returns an empty library immediately for an activated Customer with no purchases and denies it while registration is pending. Free guest acquisition remains unchanged.
- Runtime card setup requires an environment-matched `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (`sk_test_`/`pk_test_` for staging; matching live pair for production). The implementation and tests do not access Stripe accounts or production. No Wrangler secret values were read or modified.
- **Outstanding content dependency:** no canonical public Terms of Service or Privacy Policy page/URL was found in the established page records. The signup records versioned acceptance/acknowledgment, but the Owner must supply the canonical policy destinations/content before launch; this implementation does not draft legal text.
- **Verification:** `scripts/test-customer-registration.js` uses in-memory D1-shaped SQLite and mocked Stripe responses to check consent/phone rejection, migration preservation, SetupIntent flow, no charge, no PAN/CVC transfer, email-plus-card activation, empty library access, multiple cards, default/removal, and Customer access after role elevation. It is included in `npm test` and `npm run verify:launch`.
