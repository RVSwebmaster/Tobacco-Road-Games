const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTION_D1_ID = "7e2cd675-a6f1-4fac-bbc9-03485a806c26";
const STAGING_D1_ID = "d92594e8-a45c-4f84-8f48-7c3aeba17f29";
const ACCEPTANCE_D1_ID = "2fff6e72-4e41-47e7-b497-992dadcab3d6";
const ACCEPTANCE_R2_BUCKET = "trg-products-acceptance";

async function main() {
  const config = read("ops/production/wrangler.pages.toml");
  const preview = section(config, "env.preview.vars", "env.production.vars");
  const production = config.slice(config.indexOf("[env.production.vars]"));

  assert.match(config, /name\s*=\s*"tobacco-road-games"/);
  assert.match(preview, /MARKETPLACE_WRITE_POLICY\s*=\s*"disabled"/);
  assert.match(preview, /PAYMENT_PIPELINE_STAGE\s*=\s*"preview"/);
  assert.match(preview, /NATIVE_LIVE_CHECKOUT_MODE\s*=\s*"disabled"/);
  assert.match(preview, /NATIVE_GUEST_CHECKOUT_MODE\s*=\s*"disabled"/);
  assert.match(preview, /NATIVE_GUEST_CLAIM_MODE\s*=\s*"disabled"/);
  assert.match(preview, /RESEND_DELIVERY_ENABLED\s*=\s*"false"/);
  assert.doesNotMatch(preview, /d1_databases|r2_buckets|TRG_ORDERS|TRG_PRODUCTS|STRIPE|RESEND_API_KEY/);

  assert.match(production, /PAYMENT_PIPELINE_STAGE\s*=\s*"production"/);
  assert.match(production, /NATIVE_LIVE_CHECKOUT_MODE\s*=\s*"disabled"/);
  assert.match(production, /RESEND_DELIVERY_ENABLED\s*=\s*"false"/);
  assert.match(production, new RegExp(PRODUCTION_D1_ID.replaceAll("-", "\\-")));
  assert.match(production, /bucket_name\s*=\s*"trg-products"/);
  assert.doesNotMatch(production, new RegExp(`${STAGING_D1_ID}|${ACCEPTANCE_D1_ID}`));
  assert.doesNotMatch(config, /sk_(?:test|live)_|whsec_/i, "Provider credentials must never enter the Pages manifest.");

  for (const relative of [
    "ops/acceptance/wrangler.pages.toml",
    "ops/staging/wrangler.pages.toml",
    "ops/staging/wrangler.toml"
  ]) {
    const nonProduction = read(relative);
    assert.match(nonProduction, /MARKETPLACE_WRITE_POLICY\s*=\s*"enabled"/);
    assert.match(nonProduction, /PAYMENT_PIPELINE_STAGE\s*=\s*"staging"/);
    assert.match(nonProduction, /NATIVE_LIVE_CHECKOUT_MODE\s*=\s*"disabled"/);
  }

  const releaseEnvironments = JSON.parse(read("ops/release/environments.json"));
  assert.equal(releaseEnvironments.preview.projectName, "tobacco-road-games-acceptance");
  assert.equal(releaseEnvironments.preview.deploymentBranch, "acceptance");
  assert.equal(releaseEnvironments.preview.bindings.preview.d1.TRG_ORDERS, ACCEPTANCE_D1_ID);
  assert.equal(releaseEnvironments.preview.bindings.preview.r2.TRG_PRODUCTS, ACCEPTANCE_R2_BUCKET);
  assert.equal(releaseEnvironments.preview.bindings.production.d1.TRG_ORDERS, ACCEPTANCE_D1_ID);
  assert.equal(releaseEnvironments.preview.bindings.production.r2.TRG_PRODUCTS, ACCEPTANCE_R2_BUCKET);
  assert.notEqual(releaseEnvironments.preview.bindings.preview.d1.TRG_ORDERS, PRODUCTION_D1_ID);
  assert.notEqual(releaseEnvironments.preview.bindings.preview.d1.TRG_ORDERS, STAGING_D1_ID);
  assert.notEqual(releaseEnvironments.preview.bindings.preview.r2.TRG_PRODUCTS, "trg-products");
  assert.notEqual(releaseEnvironments.preview.bindings.preview.r2.TRG_PRODUCTS, "trg-products-staging");
  assert.doesNotMatch(JSON.stringify(releaseEnvironments.preview), /trg-member-tier-test-20261120/);

  const policy = await import(pathToFileURL(path.join(ROOT, "functions/_lib/preview-write-policy.mjs")).href);
  assert.equal(policy.isMarketplaceWriteDisabled(
    { MARKETPLACE_WRITE_POLICY: "disabled" },
    new Request("https://preview.example/api/cart/pay-order", { method: "POST" })
  ), true);
  let response = policy.marketplaceWriteDisabledResponse();
  assert.equal(response.status, 503);
  assert.equal(policy.isMarketplaceWriteDisabled(
    { MARKETPLACE_WRITE_POLICY: "disabled" },
    new Request("https://preview.example/api/catalog")
  ), false, "Read-only preview policy should preserve safe static/read-only review paths.");
  assert.equal(policy.isMarketplaceWriteDisabled(
    { MARKETPLACE_WRITE_POLICY: "enabled" },
    new Request("https://staging.example/api/cart/pay-order", { method: "POST" })
  ), false, "Explicitly enabled non-production environments must preserve existing marketplace behavior.");

  console.log("Pages production/preview environment isolation tests passed.");
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function section(source, startName, endName) {
  const start = source.indexOf(`[${startName}]`);
  const end = source.indexOf(`[${endName}]`, start + 1);
  assert.ok(start >= 0 && end > start, `Missing or malformed ${startName} section.`);
  return source.slice(start, end);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
