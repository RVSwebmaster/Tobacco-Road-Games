# TRG Member Account Architecture

Status: approved architecture, with the settled no-email-verification registration/login behavior recorded 2026-11-22. This is the authoritative account/Profile policy record; current implementation status is in [Project State](PROJECT-STATE.md).

## Navigation and access

- All visitors enter through the public storefront. After successful native login, every tier lands on `/customer`.
- The authenticated Customer Storefront provides Account navigation, the member's authorized Profile link, and Logout. Profile routing derives from authenticated account/tier identity, not a hardcoded universal profile URL.
- `/customer` requires a valid Customer session. Logout revokes the session and returns to the public homepage.
- Ordinary registration and login use email plus password. Email remains the login identifier, but email verification is not required for registration completion, login, or Customer access. Registration does not send verification mail or depend on Resend, SMTP, Google, or another identity provider.
- Password reset may remain email-dependent and separate from the normal registration/login path.

## Profiles and Dashboards

- One shared, dynamically populated Member Profile Base serves all six tiers. Keep the existing six HTML routes temporarily until a member-specific dynamic replacement passes functional and visual acceptance.
- Profiles may contain member identity, tier badge, biography, gaming interests, and applicable publishing information. Visibility depends on viewer privileges; detailed rules remain unresolved.
- Profile purchase-library shelves always represent the logged-in viewer, not the person whose Profile is being viewed. Without persistent shelf selections and established capacity, shelves stay empty; never auto-select an arbitrary prefix of purchases.
- Each member has a private Dashboard reached from their own Profile. Customers and Creators cannot access another member's Dashboard. Admin and Owner access follows server-authorized scope. Changes to another member require fresh authentication of the acting Admin or Owner.

## Membership relationships

- Customer privileges are inherited by higher tiers. Customers may upgrade to Creator.
- Creator publishing allocations are 12 catalog titles and 6 displayed titles.
- Premium Creator is a monthly or annual paid subscription and receives the Founding-25 publishing allocation of 24 catalog titles and 12 displayed titles. Subscription prices and the handling of excess catalog titles after expiration remain unresolved.
- Founding-25 status/badge cannot be purchased. Founding-25 and administrative designations require authorized administrative action.
- Admin and Owner inherit Customer privileges. Their administrative powers remain bounded by server-side authorization; exact display-allocation details remain subject to the approved tier records.

## Purchase library

- Purchase history is the durable record and is never changed by display selection.
- Each purchased item has independent Profile Library and Storefront Library display selections.
- Profile Library capacity is at most 36 selected books and must respect physical shelf capacity. Storefront Library capacity is at most 12.
- Persistent selection storage and physical capacity behavior remain unfinished until implemented and verified.

## Explicitly unresolved

Customer poster-frame behavior, Premium subscription prices, treatment of excess catalog titles after subscription expiration, and detailed Profile visibility rules require future decisions. This document does not claim the corresponding features are implemented or functionally accepted.
