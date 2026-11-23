const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const builder = require("./build-store.js");

const ROOT = path.resolve(__dirname, "..");
const guest = fs.readFileSync(path.join(ROOT, "guest/index.html"), "utf8");
const customer = builder.renderCustomerLandingPage(guest);
const creatorProfile = builder.renderMemberProfilePage(guest, { canonicalPath: "/creator/", creatorCatalogRotation: true });
const profileCss = fs.readFileSync(path.join(ROOT, "assets/css/member-profile.css"), "utf8");
const creatorDashboardCss = fs.readFileSync(path.join(ROOT, "assets/css/creator-dashboard.css"), "utf8");

function captureCabinetArt(markup) {
  const match = markup.match(/<picture class="shop-wall-cabinet-art"[\s\S]*?<\/picture>/);
  assert.ok(match, "page has the canonical frozen upper-cabinet artwork component");
  return match[0];
}

assert.equal(typeof builder.renderStorefrontUpperCabinet, "function");
assert.equal(typeof builder.renderMemberProfilePage, "function");
assert.equal(captureCabinetArt(customer), captureCabinetArt(guest), "Customer storefront inherits the exact Guest cabinet artwork markup");
assert.match(captureCabinetArt(creatorProfile), /upper-cabinet-creator-desktop\.png\?v=creator-title-board3/);
assert.match(captureCabinetArt(creatorProfile), /upper-cabinet-creator-tablet\.png\?v=creator-title-board3/);
assert.match(captureCabinetArt(creatorProfile), /upper-cabinet-creator-mobile\.png\?v=creator-title-board3/);
assert.doesNotMatch(captureCabinetArt(guest), /upper-cabinet-creator-desktop/);
assert.doesNotMatch(captureCabinetArt(customer), /upper-cabinet-creator-desktop/);
assert.match(customer, /data-customer-storefront/);
assert.match(creatorProfile, /data-member-profile-page/);
assert.match(creatorProfile, /data-member-identity-board/);
assert.equal((creatorProfile.match(/data-member-library-books/g) || []).length, 2);
assert.match(creatorProfile, /member-profile\.css\?v=member-profile-base1/);
assert.match(creatorProfile, /member-profile-library\.js\?v=member-profile-base1/);
assert.match(creatorProfile, /creator-profile-catalog-rotation\.js/);
assert.doesNotMatch(creatorProfile, /guest-preview-products\.json|creator-open-rules\.js|creator-dashboard-blank\.js/);
assert.match(profileCss, /body:has\(\.member-profile-shop-wall\) \.shelf-dressing\s*\{[\s\S]*?display:\s*none\s*!important/);
assert.match(profileCss, /\.creator-dashboard-identity-overlay[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(creatorDashboardCss, /@import url\('\/assets\/css\/member-profile\.css'\)/);

const dashboard = fs.readFileSync(path.join(ROOT, "creator-dashboard/index.html"), "utf8");
assert.match(dashboard, /<title>Creator Dashboard \| Tobacco Road Games<\/title>/);
assert.match(dashboard, /creator-dashboard\.js\?v=/);
assert.match(dashboard, /member-identity-board\.js\?v=member-identity-board1/);
assert.doesNotMatch(dashboard, /creator-profile-catalog-cover|creator-profile-catalog-rotation\.js/);
console.log("Shared storefront and Member Profile cabinet architecture passed.");
