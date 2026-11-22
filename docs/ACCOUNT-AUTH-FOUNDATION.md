# Shared Account Foundation

This document records the shared Tobacco Road Games account foundation for Cloudflare Pages Functions.

## Scope

The account system supports:

- native email/password registration and sign-in;
- password reset;
- TRG-owned native account session cookies;
- `/api/account/me` for the current signed-in account state.

Customer registration creates an active account and session immediately. Email verification and resend-verification are not part of the Customer authentication journey. The `email_verified` field and verification-token endpoint remain for previously issued links and separately gated features; neither controls native login or Customer Storefront access. New registrations create an active `customer_registration_states` row. Existing active accounts with pending verification metadata remain usable.

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

Native account identities resolve to `users.id`. Password hashes, session tokens, verification tokens, and reset tokens are stored separately. Session, verification, and reset tokens are stored only as hashes.

## Environment variables

Password reset mail currently uses the existing shared Resend provider and requires:

- `RESEND_API_KEY`
- `RESEND_REPLY_TO`

The outgoing From address is not configured by this account system. It comes from the existing shared store email provider as `Tobacco Road Games <orders@tobaccoroadgames.com>`. `RESEND_REPLY_TO` is the confirmed support mailbox used for replies and is already the standard store email variable. `RESEND_FROM_EMAIL` is not used by the shared account system.

Registration and native login do not use or require an email provider. Password reset remains email-dependent and outside the account-creation and sign-in path.

## Session behavior

Successful native sign-in or registration creates a TRG session in the `sessions` table and returns:

- `__Host-trg_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- `trg_account_csrf`: `Secure`, `SameSite=Lax`, `Path=/`

The session token is random and stored only as a SHA-256 hash. The CSRF token is also stored as a hash. State-changing authenticated account actions require the CSRF token.

Sign out revokes the current session and clears both cookies.

## Native password behavior

Passwords are hashed with Workers-compatible scrypt using `@noble/hashes`. The stored password format includes the scrypt parameters, salt, and derived key. Plain text passwords are never stored.

Password reset links are random, single-use, time-limited tokens stored only as hashes. Password reset request responses are intentionally generic so they do not reveal whether an email exists.

Email verification is not required to create an account, sign in, create a session, or access `/customer`. The account page does not offer resend-verification.

## Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/account/me`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`

## Local and staging notes

For local Pages development, bind the same D1 database shape. Registration and login need no mail-provider settings. Password reset requires the existing Resend settings if live reset delivery is being tested:

- `RESEND_API_KEY`: encrypted Resend API key, installed as a Pages secret.
- `RESEND_REPLY_TO`: confirmed support mailbox for replies, installed as a Pages secret.

The staging helper `ops/staging/configure-resend.ps1` installs those names without printing their values. It also installs Resend webhook and order-access secrets used by store delivery.

The account page is `account.html` and uses native email/password registration and sign-in. Google sign-in is not part of this account system.

## Settled account-policy target

The credential foundation is narrower than the settled customer-account policy. A normal customer account may additionally contain a real/legal name, optional shipping addresses, optional birthday, optional public display/profile name and avatar, notification preferences, order history, My Library entitlements, and only safe Stripe references for saved payment methods. Guest checkout remains available. Native and Google authentication continue to resolve to the same ordinary customer identity.

Seller registration upgrades that ordinary customer identity into a Creator relationship; it does not create a separate authentication system and is not an artistic or merit-based application. One seller registration includes one free primary Creator identity. Genuinely separate additional Creator identities cost $10 monthly or $100 annually each, with any Preferred fee added separately. This prevents aliases from multiplying free account-level benefits.

Every Creator identity must maintain a valid Stripe-hosted payment method. Creator registration must be fully complete, including Connect payout readiness, before product intake or listing tools become available. This applies to drafts and to paid, Free, and PWYW products. Stripe remains authoritative for card, bank, identity, KYC, and tax data; TRG stores only opaque references and safe display metadata.
