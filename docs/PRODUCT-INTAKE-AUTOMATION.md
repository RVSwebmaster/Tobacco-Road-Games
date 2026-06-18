# Product Intake Automation

This repo now includes a bulk intake routine for syncing bucket-backed product listings into the store source data.

## What it does

- Reads a bucket object listing export or a plain text key list
- Groups files by bucket folder
- Detects:
  - `cover.webp`
  - `preview.webp`
  - PDF files
- Maps bucket folders to known product slugs and listing defaults
- Adds or updates product records in `data/products.json`
- Preserves richer manual copy already present in existing product records
- Keeps default product pages in preview/catalog mode unless you deliberately add a public checkout or download URL

## Files involved

- Intake defaults and bucket folder mapping: `data/product-intake-map.json`
- Store product source of truth: `data/products.json`
- Sync routine: `scripts/sync-r2-products.js`
- Store generator: `scripts/build-store.js`

## Supported input formats

The sync script accepts any of these:

- A JSON object listing export
- A JSON array of object keys
- A plain text file with one object key per line

Valid example object keys:

```text
Tablecraft Primer/cover.webp
Tablecraft Primer/preview.webp
Tablecraft Primer/tablecraft primer.pdf
circleofcinder/cover.webp
circleofcinder/preview.webp
```

## Commands

Dry run only:

```text
node scripts/sync-r2-products.js path/to/r2-object-listing.json --dry-run
```

Write `data/products.json`:

```text
node scripts/sync-r2-products.js path/to/r2-object-listing.json
```

Write `data/products.json` and rebuild the generated store:

```text
node scripts/sync-r2-products.js path/to/r2-object-listing.json --build
```

Write a machine-readable report too:

```text
node scripts/sync-r2-products.js path/to/r2-object-listing.json --build --report owner/intake-report.json
```

## Important behavior

- Missing `cover.webp` skips the product entirely.
- Missing `preview.webp` is reported but does not block the product if the cover exists.
- Missing PDFs are reported but do not block preview/catalog listings.
- The routine does not expose paid PDFs.
- The routine does not invent checkout URLs.
- Existing manual descriptions, features, legal notes, and other richer fields are preserved when already present.

## How to extend it

When a new product bucket folder appears, add one entry to `data/product-intake-map.json` with:

- `slug`
- `folder`
- `title`
- `gameSystem`
- `gameSystemSlug`
- `productLine`
- `productLineSlug`

Optional fields like `subtitle`, `tags`, `previewPdf`, `thumbnailImage`, or cover overrides can be added when needed.
