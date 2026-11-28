const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const customer = read("customer-profile/index.html");
const runtime = read("assets/js/customer-membership-dashboard.js");
const css = read("assets/css/customer-membership-dashboard.css");
const middleware = read("functions/_middleware.js");
const navigation = read("assets/js/progressive-navigation.js");
const builder = read("scripts/build-store.js");
const pageNames = [
  "personal-information", "account-security", "purchase-history", "personal-library",
  "favorite-creators", "customer-support", "preferences", "membership-information", "trg-announcements"
];
const membershipPage = customer.match(/<section class="customer-membership-dashboard"[\s\S]*?<\/section>\s*<\/section>/)?.[0] || "";

assert.ok(membershipPage, "Customer Profile contains a Membership workspace below the existing Profile frontage.");
assert.match(customer, /customer-membership-dashboard\.css\?v=customer-membership-dashboard1/);
assert.match(customer, /customer-membership-dashboard\.js\?v=customer-membership-dashboard1/);
assert.match(customer, /data-member-identity-board/);
assert.match(customer, /data-member-tier-badge/);
assert.match(customer, /upper-cabinet-creator-desktop\.png\?v=creator-title-board3/);
assert.match(customer, /upper-cabinet-creator-tablet\.png\?v=creator-title-board3/);
assert.match(customer, /upper-cabinet-creator-mobile\.png\?v=creator-title-board3/);
assert.match(membershipPage, /<a href="\/customer-profile\/#membership" aria-current="page">Membership<\/a>/);
assert.equal((membershipPage.match(/aria-current="page"/g) || []).length, 1, "Customer sees Membership as the single selected page tab.");
for (const section of pageNames) assert.match(membershipPage, new RegExp(`id="${section}"`), `Missing Customer Membership section ${section}.`);
for (const selector of [
  "[data-membership-display-name]", "[data-membership-real-name]", "[data-membership-email]",
  "[data-membership-billing]", "[data-membership-avatar]", "[data-membership-status-value]",
  "[data-membership-joined]", "[data-membership-notices]", "[data-membership-library]"
]) assert.ok(membershipPage.includes(selector.replace(/[\[\]]/g, "")), `Missing data binding ${selector}.`);
assert.match(membershipPage, /data-membership-signout/);
assert.match(membershipPage, /Password changes are not available yet/);
assert.match(membershipPage, /Session management is not connected yet/);
assert.match(membershipPage, /transaction details, and receipts are not connected/);
assert.match(membershipPage, /Follow and unfollow controls are not connected yet/);
assert.match(membershipPage, /Accessibility preferences are not available yet/);
assert.match(membershipPage, /Member opinion requests are not connected yet/);
assert.doesNotMatch(membershipPage, /creator-dashboard|creator-analytics|owner-financial-controls|creator-listings|advertis(?:ing|ement)|publishing|earnings|admin(?:istration)? controls/i);
assert.match(runtime, /fetch\("\/api\/account\/me"/);
assert.match(runtime, /fetch\("\/api\/account\/profile"/);
assert.match(runtime, /fetch\("\/api\/account\/library"/);
assert.match(runtime, /fetch\("\/api\/auth\/logout"/);
assert.match(runtime, /item\.downloadUrl && item\.downloadAvailable/);
assert.match(runtime, /item\.currentLastUpdated !== item\.purchasedLastUpdated/);
assert.match(css, /background: #f5eedc/);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(middleware, /isCustomerMembershipDashboard\(pathname\)/);
assert.match(middleware, /membership\.accountClass !== "customer"/);
assert.match(middleware, /membership\.accountClass === "customer"/);
assert.match(navigation, /dashboard\.href = signedInCustomer \? "\/customer-profile\/" : "\/dashboard\/"/);
assert.match(builder, /canonicalPath === "\/customer-profile\/"/);

for (const profileFile of ["creator/index.html", "founding-25-profile/index.html", "premium-creator-profile/index.html", "owner-profile/index.html", "admin-profile/index.html"]) {
  assert.doesNotMatch(read(profileFile), /data-customer-membership|customer-membership-dashboard/,
    `${profileFile} remains unchanged and receives no Customer-only Dashboard workspace.`);
}
const creatorDashboard = read("creator-dashboard/index.html");
assert.doesNotMatch(creatorDashboard, /data-customer-membership|customer-membership-dashboard/,
  "Creator Dashboard remains outside this Customer foundation change.");
console.log("Customer Profile Common Membership Dashboard checks passed.");
