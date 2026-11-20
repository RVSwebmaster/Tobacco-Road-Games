# TRG Member Account Architecture

Status: Approved account architecture, documented 2026-11-20. This is a product and authorization specification, not a claim that the described behavior is implemented or accepted.

This document is the authoritative source for member account navigation, Profiles, Dashboards, personal purchase-library display, and account-tier relationships. `docs/MARKETPLACE-POLICY-CANON.md` remains authoritative for marketplace policy outside those subjects; its former Premium/Preferred membership cadence and pricing language is superseded here.

## Account navigation

- All visitors enter through the public storefront.
- Login identifies the member's privileges and redirects them to the default landing page for their account type.
- Customers land on the Customer Storefront. Its Account link opens the member's Profile.

## Member Profiles

- All account types use one shared, dynamically populated Member Profile Base.
- Keep the six existing HTML entry points temporarily: `customer-profile/index.html`, `creator/index.html`, `founding-25-profile/index.html`, `premium-creator-profile/index.html`, `admin-profile/index.html`, and `owner-profile/index.html`.
- These HTML pages are temporary entry points. They may be retired only after the dynamically generated member-specific Profile system has passed functional and visual acceptance and each replacement route is accepted.
- A Profile contains member identity, tier badge, biography, gaming interests, and applicable publishing information.
- Information visibility depends on the logged-in viewer's privileges. Detailed field-by-field visibility rules remain unresolved.
- Purchase-library shelves on a Profile always belong to the logged-in viewer, never to the person whose Profile is being visited.

## Member Dashboards

- Every member has a private Dashboard accessible from their own Profile.
- A Dashboard contains personal information, payment settings, account cancellation, and complete purchase history.
- Customers and Creators cannot open another member's Dashboard.
- Admins and Owners have authorized administrative access.
- Any change to another member's account requires fresh authentication of the Admin or Owner performing the change.

## Purchase Library

- Each purchased product has two independent, persistent display checkboxes: one for the Profile Library and one for the Storefront Library.
- The Profile Library allows at most 36 selected books, subject to physical shelf capacity.
- The Storefront Library allows at most 12 selected books.
- Display selections never change or delete the underlying purchase history.

## Membership and privileges

- Customer privileges are inherited by every higher account tier.
- A Customer may upgrade to Creator.
- A Creator may purchase Premium Creator membership monthly or annually. Premium membership prices are unresolved.
- Premium Creator receives Founding-25 publishing allocations of 24 catalog titles and 12 display titles.
- Founding-25 status and its badge cannot be purchased. Founding-25 status and administrative designations require authorized administrative action.

## Unresolved decisions

- Customer poster-frame behavior.
- Premium Creator monthly and annual prices.
- Treatment of catalog titles above the applicable allocation after Premium Creator membership expires.
- Detailed Profile information-visibility rules.

## Implementation boundary

These decisions authorize documentation only. They do not authorize changes to application code, Profile HTML, cabinet artwork, tests, migrations, or database state. Product behavior remains subject to implementation and functional and visual acceptance.
