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

Google sign-in also checks the Google Identity Services CSRF token from the `g_csrf_token` cookie and request body.

## Session behavior

Successful native or Google sign-in creates a TRG session in the `sessions` table and returns:

- `__Host-trg_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- `trg_account_csrf`: `Secure`, `SameSite=Lax`, `Path=/`

The session token is random and stored only as a SHA-256 hash. The CSRF token is also stored as a hash. State-changing authenticated account actions require the CSRF token.

Sign out revokes the current session and clears both cookies.

## Native password behavior

Passwords are hashed with Workers-compatible scrypt using `@noble/hashes`. The stored password format includes the scrypt parameters, salt, and derived key. Plain text passwords are never stored.

Password reset links are random, single-use, time-limited tokens stored only as hashes. Password reset request responses are intentionally generic so they do not reveal whether an email exists.

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
