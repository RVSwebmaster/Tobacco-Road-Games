const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const guest = read("guest/index.html");
const client = read("assets/js/guest-product-preview.js");
const css = read("assets/css/guest-landing.css");
const products = JSON.parse(read("data/guest-preview-products.json"));

assert.ok(products.length >= 5, "Staging preview must cover multiple shelf collections.");
assert.match(guest, /guest-product-preview\.js/);
assert.match(client, /showModal\(\)/);
assert.match(client, /data-guest-preview-close/);
assert.match(client, /event\.key === "Escape"/);
assert.match(client, /data-magical-bookshelf/);
assert.match(client, /shop-wall-stock-spine/);
assert.match(client, /shelfByCollection/);
assert.match(client, /product\.collection === collection/);
assert.match(client, /Number\(product\.position\) - 1/);
assert.match(client, /guest-preview-products\.json\?v=20261025-preview3/);
assert.match(client, /event\.key !== "Enter"/);
assert.match(client, /event\.key !== " "/);
assert.match(client, /\?\.focus\?\.\(\)/);
assert.match(client, /dataset\.guestProductPreview/);
assert.match(css, /\.guest-product-preview::backdrop/);
assert.match(css, /\.guest-product-preview__summary/);
assert.match(css, /\.guest-product-preview__close/);
assert.doesNotMatch(client, /guest-open-rules-mock-book--preview/);
assert.doesNotMatch(css, /guest-open-rules-mock-book--preview/);
assert.doesNotMatch(css, /content: "PREVIEW"/);
assert.equal(new Set(products.map((product) => product.collection)).size, 4, "Fixtures must span four shelf groups.");
assert.ok(products.every((product) => product.collection && Number.isInteger(product.position) && product.position > 0), "Every fixture needs a collection placement.");
for (const product of products) {
  assert.match(read("data/guest-preview-products.json"), new RegExp(product.slug));
  assert.match(client, /fullUrl/);
  const profile = read(`guest/preview-products/${product.slug}/index.html`);
  assert.match(profile, new RegExp(`data-product-slug="${product.slug}"`));
  assert.match(profile, /guest-product-preview-profile\.js/);
  assert.match(profile, /not a live catalog listing/);
}
assert.match(read("assets/js/guest-product-preview-profile.js"), /guest-preview-products\.json/);
assert.equal((guest.match(/data-mock-open-rule="true"/g) || []).length, 36, "All decorative books remain present.");
assert.doesNotMatch(guest, /data-guest-product-preview=/, "Preview records are attached by the staging-only client fixture, not hard-coded into the catalog markup.");
assert.doesNotMatch(guest, /href="\/store\/products\//, "Decorative books must not link to nonexistent catalog products.");
console.log("Guest product preview tests passed.");
