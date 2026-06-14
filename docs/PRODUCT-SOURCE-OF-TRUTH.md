# Product Source Of Truth

This site does not use a `releases.js` product system anymore.

## Edit products here

- `data/products.json`
- `data/authors.js`

## Build generated storefront pages here

- `scripts/build-store.js`

After editing product or author data, rebuild the generated output with:

```text
node scripts/build-store.js
```

## Do not use

- `releases.js`

That file exists only as a deprecation marker so nobody accidentally revives the wrong product pipeline.
