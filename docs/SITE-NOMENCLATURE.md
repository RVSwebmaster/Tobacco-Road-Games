# TRG Site Nomenclature

Last verified: 2026-11-19 against the Owner-accepted staging deployment `0fba318d-75ba-48a2-b61a-cbdb250c33c9`.

## Canonical page terms

- **Member Profile:** The shared identity-and-furniture page for a registered account. Customer, Creator, Founding-25, Premium Creator, Admin, and Owner Profiles inherit the single Member Profile Base renderer.
- **Member Profile Base:** The canonical implementation in `scripts/build-store.js::renderMemberProfilePage()`, with responsive approved cabinet artwork, common styles, identity board, shelves, emblem, and framed display. Extend this implementation; do not duplicate or reconstruct its furniture.
- **Customer Profile:** The Member Profile route `/customer-profile/`. It is distinct from the Customer Storefront at `/customer`.
- **Creator Profile:** The Member Profile at `/creator/`. It is distinct from the Creator Dashboard at `/creator-dashboard/`; existing Creator catalog cover rotation is scoped to the Profile.
- **Member Dashboard:** A distinct operational surface for account tasks. It is not another name for a Profile and does not inherit Profile identity as its page title.
- **Account class:** The class returned from the authenticated account and existing D1 records. Static Profile routes do not grant an account class or privileges.

The approved account navigation, Profile, Dashboard, library ownership, and tier definitions are maintained in [Member Account Architecture](MEMBER-ACCOUNT-ARCHITECTURE.md). This nomenclature record defines page terms and acceptance state; it does not duplicate that architecture specification.

## Acceptance state — 2026-11-19

- **Visual foundation: ACCEPTED** on staging deployment `0fba318d-75ba-48a2-b61a-cbdb250c33c9`.
- **Six routes: VERIFIED:** `/customer-profile/`, `/creator/`, `/founding-25-profile/`, `/premium-creator-profile/`, `/admin-profile/`, and `/owner-profile/`.
- **Functional acceptance pending:** authenticated identity and account-class behavior, account privileges, persistent library selection, and live Creator cover rotation. Persistent library selection is not implemented; the account library API reports purchases without a saved member shelf-selection source, so shelves remain empty rather than guessing.
- **GitHub recovery:** implementation commit `56436e3582c0d0fe4949be218ae606ebb7e09ac7` on branch `recovery/trg-member-profile-base-v1`; annotated tag `trg-member-profile-base-v1` points to that commit.
