/*
DEPRECATED: Do not add or edit product data in this file.

This Tobacco Road Games site no longer uses a releases.js product system.

Current source of truth:
- data/products.json
- data/authors.js
- scripts/build-store.js

After changing product or author data, rebuild the generated storefront with:
- node scripts/build-store.js
*/

if (typeof console !== "undefined" && typeof console.warn === "function") {
  console.warn(
    "Deprecated file: releases.js is not used by this site. Edit data/products.json and rebuild with node scripts/build-store.js."
  );
}
