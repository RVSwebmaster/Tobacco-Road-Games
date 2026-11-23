# TRG page architecture

Status verified 2026-11-23 against the current production baseline and canonical development. Live route differences and readiness findings are recorded in [POST-RECONCILIATION-AUDIT-2026-11-23.md](POST-RECONCILIATION-AUDIT-2026-11-23.md).

## Storefront and account navigation

- Guest is the canonical storefront composition. `scripts/build-store.js` owns the shared cabinet, page structure, and generated Guest/Customer pages.
- Guest Login/Signup opens the compact approved login popup, which uses native TRG authentication. Successful login lands at `/customer`.
- `/customer` is a session-protected Customer Storefront. Authenticated navigation keeps Account, Profile, and Logout actions; Profile routing follows the authenticated account class. Logout uses the existing server flow and returns to the public site. Signed-out requests do not receive Customer access.
- Registration and login are native email/password. Normal Customer access does not require email verification or an email provider. Password recovery remains a separate email-dependent flow and is not required for login.
- Forum remains deferred infrastructure. Phase 1 commit `3e78b4dadd763ce26ffd759dc97ebf5cfd9e9f9b` removes Forum links and profile panels from the Customer Account and storefront Back Room while retaining Forum routes and backend code. It is committed on development and has not been deployed to production.

## Shared Member Profile Base

`renderMemberProfilePage()` is the sole Profile renderer for Customer, Creator, Founding-25, Premium Creator, Admin, and Owner. The six route files are temporary entry points. They retain the accepted cabinet, identity board, approved tier badges, shelves, lighting, framed display, responsive assets, and shared styling. Authenticated account data supplies the identity and class; a URL alone grants no privilege.

The Profile shelf belongs to the logged-in viewer. No active persistent shelf-selection path is established, so the shelves remain empty instead of guessing a purchase selection or physical capacity. Staging retains unused schema from historical migration 055 for shelf selections and Profile customization; current application code does not use it, and production does not have those tables. Detailed visibility rules and active persistent shelf selection remain unfinished.

## Creator Dashboard

`/creator-dashboard/` is a distinct Dashboard surface, separate from a Profile. In development its template is `templates/creator-dashboard.html`; the generator inserts shared approved Creator furniture. `assets/js/creator-dashboard.js` owns Dashboard behavior, including PDF intake draft persistence checks. `assets/css/creator-dashboard.css` is a compatibility import of `assets/css/member-profile.css`, not a second furniture implementation. **Production is not yet route-aligned:** `/creator-dashboard/` redirects to `/temp-creator/`, which serves the Dashboard; development reverses that mapping. Keep the temporary production path until a separately verified release makes `/creator-dashboard/` canonical live.

## Boundaries

- Customer Storefront and Guest storefront retain the production-approved behavior from `main`.
- Creator catalog-cover rotation stays behind its existing default-off opt-in and is not activated by this reconstruction.
- Forum, saved-card UI, D1-split Open Rules shelf presentation, Stripe Express sandbox, SMTP prototype, and other shelved or superseded variants are not restored as active page behavior.
- Member account policy and membership relationships are defined in `MEMBER-ACCOUNT-ARCHITECTURE.md`; implementation status is kept separately in `PROJECT-STATE.md`.
