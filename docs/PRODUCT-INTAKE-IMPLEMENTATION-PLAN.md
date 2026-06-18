# Product Intake Implementation Plan

This document defines the real intake pipeline needed for Tobacco Road Games so new products can move from uploaded files to live store listings without repeating the current manual bucket-and-listing dance.

## Goal

Build an owner-safe workflow that can:

1. Accept product uploads (`pdf`, `cover.webp`, `preview.webp`, optional extras)
2. Collect and store listing copy and product metadata
3. Let an owner review and edit the submission
4. Publish approved assets into live product storage
5. Create or update the store listing automatically
6. Rebuild and deploy the generated storefront

## Current reality

The site already has:

- Product source of truth: `data/products.json`
- Author source of truth: `data/authors.js`
- Static store generator: `scripts/build-store.js`
- Generated store output: `store/`
- Public product image route: `functions/product-assets/[slug]/[asset].js`
- Single-entry owner bench: `owner/product-intake.html`
- Bulk listing sync helper: `scripts/sync-r2-products.js`

The site does **not** yet have:

- Real authenticated uploads
- A submissions database
- Review or approval workflow
- Automatic movement of files from intake to live storage
- Automatic published listing writes

## Architecture decision

For now, keep the current published store model:

- Published store listings remain generator-based
- `data/products.json` remains the published source of truth
- `scripts/build-store.js` remains the page generator

Do **not** rewrite the public store into a runtime database app in this phase.

That means the intake pipeline should feed the existing published pipeline rather than replace it.

## Recommended system shape

### Storage

- **R2 intake/staging bucket path**
  - Holds newly uploaded files before approval
- **R2 live product bucket path**
  - Holds approved public assets
- **D1 database**
  - Stores intake submissions, review state, and publish history

### Access control

- Owner routes must be protected
- Preferred method: **Cloudflare Access**
- The public site must not expose intake submissions, unpublished PDFs, or admin tools

### Published data flow

1. Owner uploads files and fills in product metadata
2. Submission is written to D1 and files land in intake R2 path
3. Owner reviews and edits the submission
4. Owner clicks publish
5. Publish routine copies approved files to live product bucket path
6. Publish routine creates or updates the corresponding product record
7. Store generator rebuilds `store/`
8. Site deploys from updated published output

## Proposed bucket layout

### Intake

```text
intake/products/{slug}/{submissionId}/cover.webp
intake/products/{slug}/{submissionId}/preview.webp
intake/products/{slug}/{submissionId}/product.pdf
intake/products/{slug}/{submissionId}/gallery-01.webp
intake/products/{slug}/{submissionId}/manifest.json
```

### Live

Public display assets:

```text
{liveFolder}/cover.webp
{liveFolder}/preview.webp
```

Optional non-public or later-public files:

```text
live-files/{slug}/product.pdf
live-files/{slug}/sample.pdf
```

Notes:

- Public display images can continue to be served through `/product-assets/<slug>/<asset>`
- Paid or unpublished PDFs should remain non-public unless explicitly marked for public release

## Proposed D1 tables

### `product_submissions`

- `id` text primary key
- `slug` text not null
- `title` text not null
- `author_slug` text
- `intake_prefix` text not null
- `live_folder` text
- `status` text not null
  - `draft`
  - `uploaded`
  - `in-review`
  - `approved`
  - `published`
  - `rejected`
- `metadata_json` text not null
- `asset_manifest_json` text not null
- `created_at` text not null
- `updated_at` text not null
- `published_at` text
- `published_product_slug` text
- `notes` text

### `product_publish_log`

- `id` integer primary key
- `submission_id` text not null
- `action` text not null
- `detail_json` text not null
- `created_at` text not null

## Metadata schema we need in intake

Required:

- title
- slug
- subtitle
- authors
- author slugs
- publisher
- game system
- game system slug
- product line
- product line slug
- format
- status
- short description
- long description
- featured yes/no

Recommended:

- tags
- features
- page count
- release date
- version
- legal note
- creation method
- related products
- sale fields

Asset fields:

- cover image
- preview image
- optional gallery images
- optional teaser video
- optional public sample PDF
- optional non-public full PDF

## Required routes and functions

### Owner pages

- `/owner/intake/`
  - New submission form
- `/owner/intake/submissions/`
  - Review queue
- `/owner/intake/submissions/<id>/`
  - Submission detail and publish screen

### Functions

- `POST /functions/owner/intake/upload`
  - Receives file uploads
  - Validates file type and size
  - Writes files to intake R2 path
- `POST /functions/owner/intake/submission`
  - Creates or updates submission metadata in D1
- `GET /functions/owner/intake/submissions`
  - Lists submissions for review UI
- `GET /functions/owner/intake/submissions/:id`
  - Returns one submission record
- `POST /functions/owner/intake/publish/:id`
  - Validates submission
  - Copies approved assets into live bucket path
  - Creates or updates published store record
  - Rebuilds the storefront
- `POST /functions/owner/intake/reject/:id`
  - Marks submission rejected without publishing

## Publish strategy options

There are two ways to update published store records.

### Option A: Repo write + deploy trigger

Publish action:

- updates `data/products.json`
- runs `node scripts/build-store.js`
- commits the result
- pushes to `main`

Pros:

- Matches the current site exactly
- Public store remains static and inspectable
- Easy to diff published listing changes

Cons:

- Publish routine needs Git write capability somewhere trusted

### Option B: Published store data in D1 or R2 JSON

Publish action:

- writes to a published data store directly
- public site reads runtime data instead of repo JSON

Pros:

- No Git mutation during publish

Cons:

- Bigger architecture change
- Requires refactoring the store generator/public site model

## Recommendation

Use **Option A** first.

It is the least disruptive path and keeps the store aligned with its current generator-based architecture.

## Implementation phases

### Phase 1: Intake foundations

Deliver:

- D1 schema
- protected owner routes
- upload function
- submission create/update function
- intake manifest format

Done when:

- owner can upload `cover.webp`, `preview.webp`, and `pdf`
- submission metadata is saved
- files land in intake path

### Phase 2: Review queue

Deliver:

- owner review list page
- submission detail page
- metadata editing in review
- asset preview in review

Done when:

- owner can see every pending submission
- owner can inspect uploads before publishing

### Phase 3: Publish path

Deliver:

- publish function
- live asset copy routine
- product record creation/upsert
- rebuild trigger

Done when:

- one click publishes a product into the real store
- `/store/` and `/store/products/<slug>/` update after publish

### Phase 4: Hardening

Deliver:

- validation errors
- duplicate slug detection
- bucket overwrite safety rules
- publish log
- rollback or unpublish support

Done when:

- owner can trust the routine for repeated use

## Validation rules

At minimum:

- `slug` must be lowercase hyphenated
- `cover.webp` required for publish
- `preview.webp` recommended but optional
- file types restricted by slot
- no public PDF route unless explicitly marked public
- do not publish if live folder mapping is unknown
- warn if store record would overwrite an unrelated product

## Safety rules

- Never publish directly from raw upload without review
- Never let public users access intake routes
- Never expose full PDFs by default
- Never auto-publish a product with missing required metadata
- Never let a new submission silently overwrite a different live product

## Immediate MVP recommendation

Build this first:

1. D1 table setup
2. protected `/owner/intake/` route
3. upload function to intake R2 path
4. submission save/list/detail functions
5. review queue page
6. publish function that writes live assets and emits a publish manifest

Then choose one of these for published listing writes:

- short term: owner runs a local publish-sync command from the emitted manifest
- better next step: trusted publish worker updates repo and triggers deploy automatically

## Open decisions

Before building, confirm:

1. Should intake uploads use a separate R2 bucket or an `intake/` prefix inside the existing bucket?
2. Do we want owner-only publishing at first, or future author submissions too?
3. Is Cloudflare Access acceptable for owner route protection?
4. For publish, do we want:
   - local trusted script to update Git and push
   - or a hosted trusted service to update Git automatically

## Suggested next build order

If starting immediately, do the work in this order:

1. Add D1 schema and migration doc
2. Add protected owner intake routes and form shell
3. Add upload function writing to intake R2
4. Add D1 submission save/list/detail endpoints
5. Add review queue UI
6. Add publish manifest generator
7. Add publish/upsert step into `data/products.json`
8. Trigger rebuild and deploy

## Success criteria

The intake pipeline is successful when:

- an owner can upload product files once
- enter the listing copy once
- review the submission once
- click publish once
- and the product appears in the live store without hand-editing `data/products.json`, hand-moving files, or guessing bucket paths
