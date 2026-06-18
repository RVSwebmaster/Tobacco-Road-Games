# Product Source Of Truth

This site does not use a `releases.js` product system anymore.

## Current editing map

- Public homepage: `index.html`
- Store and product data: `data/products.json`
- Author data: `data/authors.js`
- Store generator: `scripts/build-store.js`
- Bucket/listing intake sync: `scripts/sync-r2-products.js`
- Generated store output: `store/`
- Old `releases.js`: warning stub only

## Edit products here

- `data/products.json`
- `data/authors.js`

## What each file does

- `index.html` controls the public homepage messaging and homepage feature callout.
- `data/products.json` is the source of truth for store products, product metadata, featured-store selection inputs, and generated product pages.
- `data/authors.js` is the source of truth for public author profiles, author bios, and author workshop posts.
- `scripts/build-store.js` reads the source data and writes the generated store pages.
- `scripts/sync-r2-products.js` can upsert `data/products.json` from a bucket object listing export before the store is rebuilt.
- `store/` is generated output. Do not hand-edit it unless you are intentionally patching generated files and understand they can be overwritten by the next rebuild.

## Build generated storefront pages here

- `scripts/build-store.js`

After editing product or author data, rebuild the generated output with:

```text
node scripts/build-store.js
```

To automate bucket-backed product listing intake from an R2 object listing export:

```text
node scripts/sync-r2-products.js path/to/r2-object-listing.json --build
```

## Do not use

- `releases.js`

That file exists only as a deprecation marker so nobody accidentally revives the wrong product pipeline.
