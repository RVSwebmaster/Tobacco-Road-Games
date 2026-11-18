const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const builder = require("./build-store.js");
const ROOT = path.resolve(__dirname, "..");

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
assert.equal(captureCabinetArt(customer), captureCabinetArt(guest), "Customer inherits the exact Guest cabinet artwork markup");
const creatorCabinet = captureCabinetArt(creator);
assert.match(creatorCabinet, /<img src="\/assets\/images\/storefront-shelf-dressing\/upper-cabinet-creator-desktop\.png\?v=creator-title-board3"/,
  "Creator uses the role-specific title-board artwork on desktop");
assert.match(creatorCabinet, /upper-cabinet-creator-tablet\.png\?v=creator-title-board3/,
  "Creator uses the plant-free role-specific tablet artwork");
assert.match(creatorCabinet, /upper-cabinet-creator-mobile\.png\?v=creator-title-board3/,
  "Creator uses the plant-free role-specific mobile artwork");
assert.match(creatorCabinet, /<img src="\/assets\/images\/storefront-shelf-dressing\/upper-cabinet-creator-desktop\.png\?v=creator-title-board3"/,
  "Creator uses the plant-free role-specific desktop fallback");
assert.doesNotMatch(captureCabinetArt(guest), /upper-cabinet-creator-desktop/);
assert.doesNotMatch(captureCabinetArt(customer), /upper-cabinet-creator-desktop/);

for (const page of [guest, customer]) {
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
assert.match(creator, /creator-dashboard-trg-emblem/);
assert.match(creator, /golden-d20-lantern-logo\.png/);
assert.doesNotMatch(creator, /class="shop-wall-identity-sign"/,
  "Creator removes the shared central identity sign so the title board does not duplicate the partnership mark");
assert.doesNotMatch(creator, /class="shop-wall-identity-title"/,
  "Creator removes the shared central wordmark from the title board");
assert.match(guest, /class="shop-wall-identity-sign"/,
  "Guest retains the approved central identity sign");
assert.match(customer, /class="shop-wall-identity-sign"/,
  "Customer retains the approved central identity sign");
assert.match(creator, /creator-dashboard\.css/);
assert.match(creatorCss, /body:has\(\.creator-dashboard-shop-wall\) \.shelf-dressing\s*\{[\s\S]*?display:\s*none\s*!important/,
  "Creator hides the rotating shelf dressing without changing Guest or Customer");
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
assert.match(creator, /class="shop-wall-back-wall-art shop-wall-back-wall-art--right creator-dashboard-open-rules-poster"[^>]+the-familiar-framed-poster\.png/, "Creator alone receives the framed Open Rules poster");
assert.match(creator, /class="creator-dashboard-open-rules-light-cover"/, "Creator alone receives the scoped light-effect cover");
assert.doesNotMatch(guest, /creator-dashboard-open-rules-poster/, "Guest does not inherit the Creator poster");
assert.doesNotMatch(customer, /creator-dashboard-open-rules-poster/, "Customer does not inherit the Creator poster");
assert.doesNotMatch(guest, /creator-dashboard-open-rules-light-cover/, "Guest does not inherit the Creator light-effect cover");
assert.doesNotMatch(customer, /creator-dashboard-open-rules-light-cover/, "Customer does not inherit the Creator light-effect cover");
const dashboard = fs.readFileSync(path.join(ROOT, "creator-dashboard/index.html"), "utf8");
assert.match(dashboard, /class="creator-dashboard-shop-wall"/, "Creator Dashboard uses the canonized furniture wrapper");
assert.equal((dashboard.match(/shop-wall-fixed-cabinet/g) || []).length, 1, "Dashboard furniture is generated once through the shared renderer");
assert.match(dashboard, /upper-cabinet-creator-desktop\.png\?v=creator-title-board3/, "Creator Dashboard uses the Creator cabinet artwork");
assert.match(dashboard, /class="shop-wall-back-wall-art shop-wall-back-wall-art--right creator-dashboard-open-rules-poster"/, "Creator Dashboard uses the framed right-bay poster");

console.log("Shared storefront cabinet architecture passed.");
