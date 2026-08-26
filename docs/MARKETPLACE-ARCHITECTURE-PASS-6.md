# Marketplace Architecture — Pass 6

## Controlled publication boundary

Creator dashboard writes remain private D1 operational records. Review approval changes `publication_state` to `approved`; it does not publish. A separate owner-authenticated publication action maps an approved record through `creator-publication-map.mjs`, verifies required public fields and accepted files, promotes accepted quarantine objects into the established private product layout, and dispatches the existing `owner_publish_intake` GitHub workflow. The workflow applies the explicit payload to `data/products.json`, regenerates the storefront and runtime catalog, and commits only after the build succeeds. A failed Actions checkout is discarded, leaving the canonical branch unchanged.

The public product identity is the immutable normalized listing slug. `creatorId` is authoritative marketplace ownership; `authors` and `authorSlugs` remain compatibility/public-credit fields. A collision with a runtime product is rejected unless the listing is already explicitly connected through `source_product_slug`. Synchronization upserts one slug idempotently and leaves unrelated products untouched.

## Field policy

Publication candidates include title, descriptions, creator identity, reviewed public images, genre, system, media type, format, discovery metadata, integer-cent regular price, and reviewed sale fields. The mapping supplies conservative public defaults for the independent creator product line, currency, status, library/update eligibility, and creator attribution.

Creators cannot submit creator ownership, public feature/ranking flags, delivery keys, R2 paths, Stripe data, entitlement configuration, fulfillment internals, moderation state, legal overrides, or operator publication state. Existing-product upserts preserve unrelated historical/operator fields and change only fields represented by the validated publication payload.

## Private files and validation

`POST /api/creator/listings/:id/files` requires the existing account session, CSRF, and a membership controlling that listing. Files use random quarantine keys under `creator-quarantine/`; keys are never returned. Product files are PDF (50 MB maximum), cover/preview files are WebP (10 MB), and supporting files may be PDF, WebP, PNG, or JPEG (20 MB). Declared MIME and magic bytes must agree, names are normalized, replacement uploads supersede earlier files, and upload metadata marks scanning as pending.

Files move through `uploaded`, `validating`, `accepted`, `rejected`, and `superseded`. Operator actions accept or reject a staged file and record a plain-language message. The acceptance action is the current malware/scanning hook: production should connect it to an automated scanner before allowing routine third-party creator publication. An accepted cover is mandatory; digital/hybrid products also require an accepted PDF. Rejected or missing required files fail closed.

Only the operator publication route can copy accepted objects to `<stable-slug>/cover.webp`, optional `preview.webp`, and `<stable-slug>/product.pdf`. Runtime delivery mapping recognizes published creator products by `creatorId` and uses the existing fulfillment, entitlement, and signed-download code. Creator uploads never become public downloads and never create entitlements.

## Pricing, sales, bundles, and pause

Published regular and sale prices are integer cents mapped into the existing product schema. Checkout continues reading the server-built runtime catalog. Sale start/end values are evaluated server-side; date-only ends retain end-of-day semantics while timestamp ends expire at the exact instant.

Creator bundle publication requires at least two already-published listings owned by the same creator. Operator publication maps the bundle idempotently into `data/bundle-rules.json`; cross-creator bundles remain blocked. Public presentation of multiple creator bundles remains deliberately minimal pending the next storefront bundle iteration.

A creator pause remains an operational request. The operator `pause_publication` action changes the canonical public product to a retained not-for-sale record rather than deleting it. Historical orders, download entitlements, My Library rows, files, and audits are untouched.

## Audits and recovery

Submission/review audit remains in `creator_review_audit`; file and listing publication actions use `creator_publication_audit`; bundle publication uses `creator_bundle_publication_audit`. Context contains IDs, purposes, validation messages, public slugs, and approved cents—not credentials, quarantine paths, GitHub tokens, signed URLs, or payment secrets.

On failure, fix the D1 candidate or file state and retry the idempotent publication action. If file promotion succeeded but dispatch failed, retry reuses the stable target keys. If the workflow fails validation/build, no branch commit occurs and the creator record remains available with failure details. Operator can compare the workflow run before retrying.

## Deferred intentionally

- automated malware scanning service and asynchronous `validating` worker;
- transactional confirmation from GitHub back to D1 (the current successful dispatch/run result marks published);
- rich operator file preview and validation UI;
- public multi-bundle merchandising and collaborative cross-creator bundles;
- physical fulfillment mapping;
- automatic cleanup of superseded quarantine objects;
- canonical `/creators/` URL migration.
