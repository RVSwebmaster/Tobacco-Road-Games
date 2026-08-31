const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const account = read("account.html");
const accountScript = read("assets/js/account.js");
const creator = read("creator/index.html");
const creatorScript = read("assets/js/creator-dashboard.js");
const registration = read("functions/_lib/creator-registration.mjs");

assert.match(account, /Sell on Tobacco Road Games/);
assert.match(account, /Become a Creator/);
assert.match(account, /first Creator identity is free/i);
assert.match(account, /product intake becomes available after every registration step is complete/i);
assert.match(account, /Creator Identity <span>Public<\/span>/);
assert.match(account, /Business &amp; Contact Information <span>Private<\/span>/);
assert.match(account, /Current agreement version/);
assert.match(account, /Read the current agreement notice/);
assert.match(account, /Stripe-hosted payment method/);
assert.match(account, /Stripe Connect payout account/);
assert.doesNotMatch(account, /AI disclosure|production-method disclosure/i);

assert.match(accountScript, /Creator registration is complete/);
assert.match(accountScript, /Needs attention/);
assert.match(accountScript, /paymentMethodReady:\s*["']Payment Method["']/);
assert.match(accountScript, /payoutReady:\s*["']Payout Setup["']/);
assert.match(accountScript, /accept_current_agreement/);
assert.match(accountScript, /creatorDashboardLink\.hidden\s*=\s*!creator\.registrationComplete/);

assert.match(creator, /id="creator-listings" hidden/);
assert.match(creator, /id="creator-advertising" hidden/);
assert.match(creator, /id="creator-analytics-card" hidden/);
assert.match(creatorScript, /if \(!summary\.intakeAccess\) return;/);
assert.ok(
  creatorScript.indexOf("if (!summary.intakeAccess) return;") <
    creatorScript.indexOf('api("listings")'),
);
assert.match(creatorScript, /Product intake, drafts, uploads, pricing, bundles, analytics, and advertising remain unavailable/);

assert.match(registration, /paymentCollection/);
assert.match(registration, /accept_current_agreement/);
assert.match(registration, /acceptCreatorAgreement/);
assert.doesNotMatch(registration, /card_number|bank_account|routing_number|tax_id/i);

console.log("Creator onboarding UX tests passed.");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}
