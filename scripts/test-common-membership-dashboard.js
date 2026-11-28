const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("dashboard/index.html");
const script = read("assets/js/member-dashboard.js");
const css = read("assets/css/member-dashboard.css");
const identity = read("assets/js/member-identity-board.js");
const middleware = read("functions/_middleware.js");

for (const section of ["personal-information", "account-security", "purchases", "personal-library", "favorite-creators", "preferences", "membership-information"]) {
  assert.match(page, new RegExp(`id="${section}"`), `Dashboard section ${section} exists.`);
}
assert.match(page, /upper-cabinet-creator-desktop\.png\?v=creator-title-board3/);
assert.match(page, /upper-cabinet-creator-tablet\.png\?v=creator-title-board3/);
assert.match(page, /upper-cabinet-creator-mobile\.png\?v=creator-title-board3/);
assert.match(page, /data-member-identity-board/);
assert.match(page, /data-member-tier-badge/);
assert.match(page, /data-dashboard-navigation/);
assert.match(identity, /document\.querySelector\("\[data-member-tier-badge\]"\)/);
assert.match(script, /fetch\("\/api\/account\/me"/);
assert.match(script, /fetch\("\/api\/account\/profile"/);
assert.match(script, /fetch\("\/api\/account\/library"/);
assert.match(script, /location\.replace\("\/account\.html"\)/);
assert.match(script, /textContent = String\(item\.productTitle/);
assert.match(middleware, /isMemberDashboard\(pathname\).*getCustomerSessionFromRequest/);
assert.match(middleware, /pathname === "\/dashboard\/"/);
assert.match(page, /Active session review and sign-out-all-devices are not connected yet/);
assert.match(page, /Password recovery email is currently disabled/);
assert.doesNotMatch(page, /forgot-form|password recovery.*available/i);
assert.match(page, /Following and unfollowing are not connected yet/);
assert.match(page, /Communication, accessibility, and announcement preferences are not connected yet/);
assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 720px\)/);
assert.doesNotMatch(page, /creator-dashboard\.js|creator-analytics|owner-financial-controls|creator-listings/);
assert.doesNotMatch(page, /storefront-ad|store-open|checkout/);
console.log("Common Membership Dashboard structure and scope checks passed.");
