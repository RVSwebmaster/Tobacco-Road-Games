const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const CORE_TESTS = [
  "scripts/test-creator-publishing-sandbox.js",
  "scripts/test-news-chiron.js"
];

const STAGING_TESTS = [
  "scripts/test-owner-profile-preview.js",
  "scripts/test-owner-profile-phase1.js",
  "scripts/test-creator-product-submission-sandbox.js",
  "scripts/test-creator-ownership-enforcement-sandbox.js",
  "scripts/test-creator-owner-review-access-sandbox.js",
  "scripts/test-creator-owner-review-decisions-sandbox.js",
  "scripts/test-creator-product-publication-sandbox.js",
  "scripts/test-creator-active-shelf-slots.js",
  "scripts/test-creator-product-withdrawal.js",
  "scripts/test-creator-publishing-end-to-end.js",
  "scripts/test-product-inactivity-shelf-expiration.js",
  "scripts/test-owner-listing-file-maintenance.js",
  "scripts/test-preferred-internal-purchase-policy.js",
  "scripts/test-preferred-internal-purchase-ui.js",
  "scripts/test-preferred-internal-purchase-repairs.js",
  "scripts/test-creator-service-refunds.js",
  "scripts/test-preferred-recurring-billing.js",
  "scripts/test-additional-identity-billing.js",
  "scripts/test-stripe-ad-credit-service-revenue.js",
  "scripts/test-creator-balance-service-purchases.js",
  "scripts/test-creator-balance-internal-purchases.js",
  "scripts/test-marketplace-discovery-labels.js",
  "scripts/test-launch-week-creator-reputation.js",
  "scripts/test-marketplace-operations-completion.js",
  "scripts/test-marketplace-pass10.js",
  "scripts/test-marketplace-pass11.js",
  "scripts/test-marketplace-pass12.js",
  "scripts/test-marketplace-pass13.js",
  "scripts/test-marketplace-pass14.js",
  "scripts/test-registration-hard-gate.js",
  "scripts/test-creator-onboarding-ux.js",
  "scripts/test-transaction-payout-policy.js",
  "scripts/test-creator-agreement-draft.js",
  "scripts/test-creator-agreement-crosswalk.js",
  "scripts/test-cumulative-partial-refunds.js"
];

function run(script) {
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// The Owner Profile pair is the explicit staging-workspace marker. Production
// main may contain a few historical sandbox scripts, but they are not part of
// its production pretest contract and must not make the lifecycle ambiguous.
const hasStagingExtension = ["scripts/test-owner-profile-preview.js", "scripts/test-owner-profile-phase1.js"]
  .every((script) => existsSync(join(process.cwd(), script)));
const suite = hasStagingExtension ? [...CORE_TESTS, ...STAGING_TESTS] : CORE_TESTS;
const missing = suite.filter((script) => !existsSync(join(process.cwd(), script)));
if (missing.length) {
  console.error(`Pretest suite is incomplete; missing: ${missing.join(", ")}`);
  process.exit(1);
}
for (const script of suite) run(script);
