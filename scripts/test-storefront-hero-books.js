const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { selectHomepageShelfBooks, renderHomepageMerchandisingBooks, renderHomepageProductBay, renderHomepageShopWallMain } = require("./build-store.js");
const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const homepage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "data/homepage-merchandising.json"), "utf8"));
const ids = ["featured-creator-wall-heading", "new-this-week-wall-heading", "best-sellers-wall-heading", "free-pwyw-wall-heading"];
const product = i => ({ id: `id-${i}`, slug: `title-${i}`, title: `Title ${i}`, status: "available-direct", url: `/store/products/title-${i}/`, assetSet: { cover: "/assets/products/spriggans/cover.webp" }, authorSlugs: ["creator-one"], releaseStamp: i, updatedStamp: i, priceCents: 0, discoveryLabels: ["best_selling"] });
const inventory = Array.from({ length: 60 }, (_, i) => product(i));
const count = (html, pattern) => (html.match(pattern) || []).length;
assert.deepEqual(Object.keys(config), ids);
assert.match(css, /\.shop-wall-product-row--hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 21fr\) minmax\(0, 8fr\) minmax\(0, 21fr\);/);
assert.match(css, /\.shop-wall-product-row--hero\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/);
assert.match(css, /body:has\(\.shop-wall-product-row--hero\)\s*\{\s*overflow-x:\s*clip;/);
assert.match(css, /\.shop-wall-spine-run\s*\{[^}]*grid-template-columns:\s*repeat\(21, minmax\(0, 1fr\)\);/);
assert.match(css, /\.shop-wall-hero-book\s*\{[^}]*width:\s*75%;/);
assert.match(css, /\.shop-wall-hero-book > img\s*\{[^}]*max-height:[^;]*\* 0\.8\);[^}]*object-fit:\s*contain;/);
assert.doesNotMatch(css.slice(css.indexOf("/* Merchandising books occupy")), /left:\s*calc\(16|right:\s*calc\(16|--shop-wall-merch-(?:bay-height|product-space|shelf-construction):/);

for (const n of [0, 1, 2, 20, 21, 22, 42, 43, 44, 60]) {
  const products = inventory.slice(0, n);
  const selection = selectHomepageShelfBooks(products);
  assert.equal(selection.hero, products[0] || null);
  assert.equal(selection.left.length, Math.min(21, Math.max(0, n - 1)));
  assert.equal(selection.right.length, Math.min(21, Math.max(0, n - 22)));
  assert.deepEqual([...selection.left, ...selection.right], products.slice(1, 43));
  const html = renderHomepageMerchandisingBooks(products);
  const runs = [...html.matchAll(/<div class="shop-wall-spine-run"[^>]*>([\s\S]*?)<\/div>/g)];
  assert.equal(runs.length, 2);
  for (const run of runs) assert.equal(count(run[1], /<(?:a|figure) class="shop-wall-(?:sale|stock)-spine"/g), 21);
  assert.equal(count(html, /data-product-id=/g), Math.min(n, 43));
  assert.equal(count(html, /data-decorative-stock/g), 42 - Math.min(42, Math.max(0, n - 1)) + (n ? 0 : 1));
  assert.equal(count(html, /class="shop-wall-hero-book(?: shop-wall-hero-book--stock)?"/g), 1);
  for (const filler of html.matchAll(/<figure\b[\s\S]*?<\/figure>/g)) {
    assert.doesNotMatch(filler[0], /href=|tabindex=|data-product|price|<a\b|<button\b/);
    assert.match(filler[0], /Decorative/);
  }
  const productIds = [...html.matchAll(/data-product-id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(productIds).size, productIds.length);
  if (n) assert.match(html, /class="shop-wall-hero-book" data-product-card data-slug="title-0"[^>]*href="\/store\/products\/title-0\/"[^>]*aria-label="Open Title 0 product page"/);
}
const configured = selectHomepageShelfBooks(inventory, "id-55");
assert.equal(configured.hero, inventory[55]);
assert.deepEqual(configured.left, inventory.slice(0, 21));
assert.deepEqual(configured.right, inventory.slice(21, 42));
assert.equal(selectHomepageShelfBooks(inventory, "absent").hero, inventory[0]);
const ineligible = [{ ...product(1), status: "coming-soon" }, { ...product(2), status: "retired" }, { ...product(3), buyMode: "retired" }, { ...product(4), status: "legacy-not-for-sale" }];
assert.equal(selectHomepageShelfBooks(ineligible).hero, null);
assert.equal(selectHomepageShelfBooks([...ineligible, product(7)], "id-1").hero.id, "id-7");
assert.equal(selectHomepageShelfBooks([product(1), product(1), product(2)]).left.length, 1);
const slugOnly = { ...product(2), id: undefined };
assert.equal(selectHomepageShelfBooks([product(1), slugOnly], slugOnly.slug).hero, slugOnly);
const markup = renderHomepageMerchandisingBooks([{ ...product(1), title: 'A & "Book" <test>' }]);
assert.match(markup, /A &amp; &quot;Book&quot; &lt;test&gt;/);
assert.doesNotMatch(markup, /data-center-examination|bookshelf-book__cover-frame|data-fill-spines/);

for (const id of ids) {
  const bay = renderHomepageProductBay({ title: id, id, products: [], singleShelf: true });
  assert.equal(count(bay, /data-book-units="50"/g), 1);
}
for (const id of ["open-rules-library-heading", "your-library-heading", "unrelated-shelf"]) {
  const bay = renderHomepageProductBay({ title: id, id, products: [], singleShelf: true });
  assert.doesNotMatch(bay, /data-hero-units|data-book-units/);
}
const former = config[ids[0]];
try {
  // The builder and this require share the same JSON module only through disk, so
  // test configured creator/product selection in an isolated module instance.
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(ROOT, "scripts/build-store.js"), "utf8");
  const customConfig = Object.fromEntries(ids.map(id => [id, { heroProductId: "id-9" }]));
  customConfig[ids[0]].creatorSlug = "creator-two";
  const moduleObject = { exports: {} };
  const fakeFs = { ...fs, readFileSync: (file, encoding) => String(file).endsWith("homepage-merchandising.json") ? JSON.stringify(customConfig) : fs.readFileSync(file, encoding) };
  const customRequire = name => name === "node:fs" ? fakeFs : require(name);
  vm.runInNewContext(source, { require: customRequire, module: moduleObject, __dirname: path.join(ROOT, "scripts"), process, console });
  const differentCreator = { ...product(9), authorSlugs: ["creator-two"] };
  const html = moduleObject.exports.renderHomepageShopWallMain([{ ...product(1), releaseStamp: 99 }, differentCreator]);
  const featured = html.match(/aria-labelledby="featured-creator-wall-heading"[\s\S]*?<\/section>/)[0];
  assert.match(featured, /data-product-id="id-9"/);
  assert.doesNotMatch(featured, /data-product-id="id-1"/);
  for (const id of ids.slice(1)) {
    const bay = html.match(new RegExp(`aria-labelledby="${id}"[\\s\\S]*?<\\/section>`))[0];
    assert.match(bay, /class="shop-wall-hero-book"[^>]*data-product-id="id-9"/);
    assert.equal(count(bay, /data-product-id="id-9"/g), 1);
    assert.match(bay, /data-product-id="id-1"/);
  }
} finally {
  assert.equal(config[ids[0]], former);
}
assert.equal(count(homepage, /data-book-units="50"/g), 4);
assert.equal(count(homepage, /data-hero-units="8"/g), 4);
assert.equal(count(homepage, /data-spine-slots="21"/g), 8);
console.log("Storefront hero books passed: selection, 21/8/21 geometry, capacity, fillers, accessibility, scope.");
