const assert = require("node:assert/strict");
const fs = require("node:fs");
const builder = require("./build-store.js");

const guest = fs.readFileSync("guest/index.html", "utf8");
const creatorCss = fs.readFileSync("assets/css/creator-dashboard.css", "utf8");
const customer = builder.renderCustomerLandingPage(guest);
const creator = builder.renderCreatorIdentityPage(guest);

function captureCabinetArt(markup) {
  const match = markup.match(/<picture class="shop-wall-cabinet-art"[\s\S]*?<\/picture>/);
  assert.ok(match, "page has the canonical frozen upper-cabinet artwork component");
  return match[0];
}

assert.equal(typeof builder.renderStorefrontUpperCabinet, "function");
assert.equal(typeof builder.renderCreatorIdentityPage, "function");
assert.equal(captureCabinetArt(creator), captureCabinetArt(guest), "Creator inherits the exact Guest cabinet artwork markup");
assert.equal(captureCabinetArt(customer), captureCabinetArt(guest), "Customer inherits the exact Guest cabinet artwork markup");

for (const page of [guest, customer, creator]) {
  assert.match(page, /shop-wall-fixed-cabinet/);
  assert.match(page, /upper-cabinet-desktop\.png\?v=20261004-frozen1/);
  assert.match(page, /upper-cabinet-tablet\.png\?v=20261004-frozen1/);
  assert.match(page, /upper-cabinet-mobile\.png\?v=20261004-frozen1/);
}

assert.match(customer, /data-customer-storefront/);
assert.match(customer, /data-customer-library-row/);
assert.match(creator, /data-creator-identity-page/);
assert.match(creator, /id="creator-status"[^>]*role="status"/, "Creator identity runtime retains its live status node");
assert.match(creator, /data-creator-library-books/);
assert.match(creator, /creator-dashboard-identity-overlay/);
assert.match(creator, /creator-dashboard\.css/);
assert.match(creator, /guest-landing\.css/);
assert.doesNotMatch(creatorCss, /creator-dashboard-shop-wall[^{}]*shop-wall-(?:row--identity|shelf-level|product-row)/,
  "Creator CSS does not duplicate common frame or shelf geometry");
assert.doesNotMatch(creatorCss, /homepage-open-rules-book|shop-wall-fixed-cabinet/,
  "Creator CSS leaves shared book sizing and cabinet rules in canonical stylesheets");
for (const script of ["storefront.js", "open-rules-library.js", "homepage-shelves.js", "creator-open-rules.js", "guest-product-preview.js", "creator-dashboard-blank.js"]) {
  assert.ok(creator.includes(`/assets/js/${script}`), `Creator retains the ${script} runtime`);
}
assert.doesNotMatch(creator, /data-magical-bookshelf/, "Creator shelves do not inherit Guest arrival animations");
assert.doesNotMatch(creator, /shop-wall-row--merchandising|shop-wall-row--bric-a-brac/, "Creator identity page does not inherit lower merchandising sections");
assert.equal((creator.match(/data-creator-library-books/g) || []).length, 2, "Creator personal library retains two ownership rows");
assert.equal((creator.match(/class="shop-wall-product-row shop-wall-product-row--library guest-open-rules-row"/g) || []).length, 2, "Creator Open Rules cabinet retains both empty furniture rows");

console.log("Shared storefront cabinet architecture passed.");
