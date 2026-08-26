# Marketplace Architecture — Pass 5

## Identity and permissions

`marketplace_creators` is the durable creator record. `creator_memberships` joins authenticated `users` to one or more creators with `manager`, `editor`, or `analyst` permission. Every creator API resolves the membership server-side; a requested creator is accepted only when the current user has that membership. Creator ownership is never accepted from form input.

RV Sawyer is seeded as `creator-rv-sawyer`. Migration 018 assigns existing `owner` and `admin` site accounts to that creator using the normal membership table. A future approved creator requires database records for the creator and membership, not a code change. The bootstrap should be checked after production migration because an RV account with the ordinary `user` role is intentionally not guessed or elevated.

`creator_listings.creator_id` is authoritative for permissions. Existing `authors`, `authorSlugs`, `data/authors.js`, slugs, and creator URLs remain untouched for storefront compatibility. `source_product_slug` connects an operational listing to the existing public product and order-item snapshot. Collaborative credit can continue in compatibility fields; future collaborative edit rights should use an explicit listing-collaborator table rather than weakening ownership checks.

## Lifecycle and publication boundary

Creator listings support `draft`, `submitted`, `active`, `paused`, `needs_changes`, and `rejected`. Creators can create drafts, edit drafts/paused/needs-changes records, submit them, and pause an active listing. Operators review submitted records through the protected owner API and write a review audit record.

The creator operations tables are deliberately not a second public catalog. Existing JSON product data remains the commerce and storefront source of truth. Operator approval changes operational review state but does not dispatch a build, upload files, modify Stripe, alter entitlement mappings, or silently publish. A future controlled synchronization step must validate and copy approved records into the established owner publication workflow.

## Profiles, pricing, sales, and bundles

Creators may edit bounded public profile content, safe HTTP(S) or site-relative media references, template, accent, and external links. Slug, creator ID, ownership, and marketplace status are excluded.

Draft listing prices and sale schedules use integer cents and validated dates. They do not affect quote or checkout behavior until the deferred operator-controlled publication sync exists. Creator bundles reuse listing ownership and allow only listings controlled by the same creator. Bundle records are draft operational data; the existing public bundle behavior remains authoritative.

## Analytics and privacy

Creator analytics join paid orders to creator-owned `source_product_slug` values and expose aggregate order count, units, gross line revenue, and per-product totals. They do not return customer email, name, account ID, Stripe data, entitlement data, order references, or marketplace-wide totals. Operator marketplace analytics and order-level customer support remain separate future capabilities.

## Deferred intentionally

- approved-record synchronization into `data/products.json`, file upload, and the existing publish workflow;
- polished creator editing UI for every listing field, sales scheduler, and bundle editor;
- private listing-file upload and operator validation reports;
- order-level creator support access;
- collaborative listing permissions and cross-creator bundles;
- discount performance attribution and time-series analytics;
- automatic synchronization of profile edits back to `data/authors.js`;
- canonical `/creators/` migration.
