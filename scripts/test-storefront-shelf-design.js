const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const page = read("store/index.html"), css = read("styles.css"), storefront = read("assets/js/storefront.js"), sponsor = read("assets/js/sponsor-marquee.js"), rotation = read("functions/_lib/ad-rotation.mjs"), middleware = read("functions/_middleware.js");
const order = ["id=\"open-rules-shelf-heading\"", "class=\"sponsor-marquee\"", "id=\"new-releases-bookshelf-heading\"", "id=\"best-sellers-shelf-heading\"", "id=\"pwyw-free-shelf-heading\"", "id=\"search-results-heading\"", "class=\"store-lower\""];
for (let index = 1; index < order.length; index += 1) assert.ok(page.indexOf(order[index - 1]) < page.indexOf(order[index]), `${order[index - 1]} must precede ${order[index]}.`);
assert.match(page, /bookshelf-book__spine/); assert.match(page, /bookshelf-book__cover-frame/); assert.match(page, /bookshelf-book__details/); assert.match(page, /loading="lazy" decoding="async"/);
assert.match(page, /data-search-results="true"/); assert.match(storefront, /Search Results —/); assert.match(storefront, /api\/discovery-labels/); assert.doesNotMatch(storefront, /best.?sell.*sort/i);
assert.match(sponsor, /target = "_blank"/); assert.match(sponsor, /noopener noreferrer sponsored/); assert.match(sponsor, /mouseenter/); assert.match(sponsor, /focusin/); assert.match(sponsor, /prefers-reduced-motion/); assert.match(sponsor, /log\(item, "click"\)/);
assert.match(rotation, /pool === "sponsor-marquee"/); assert.match(rotation, /vendor_sponsor','event/); assert.match(middleware, /pathname!==['"]\/store\/['"]/);
assert.ok(JSON.parse(read("_routes.json")).include.includes("/api/ad-rotation"));
assert.match(css, /position:sticky;top:var\(--store-header-height\)/); assert.match(css, /scroll-snap-type:x proximity/); assert.match(css, /prefers-reduced-motion:reduce/); assert.match(storefront, /pointer: coarse/); assert.match(storefront, /event\.preventDefault\(\)/);
assert.match(page, /href="\/store\/products\/[^"]+\/"/); assert.match(page, /data-cart-add=/); assert.doesNotMatch(page, /data-ad-pool="public"/);
console.log("TRG shelf storefront design tests passed.");
