const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const pipeline = await import(pathToFileURL(path.resolve(__dirname, "release-pipeline.mjs")).href);
  const environments = require("../ops/release/environments.json");
  const migrationLedger = require("../ops/release/migrations.json");
  const sha = "1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6";
  const manifestSha = "d".repeat(64);

  const stagingToml = `name = "tobacco-road-games-staging"
[vars]
MARKETPLACE_WRITE_POLICY = "disabled"
NATIVE_GUEST_CHECKOUT_MODE = "disabled"
NATIVE_GUEST_CLAIM_MODE = "disabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "preview"
RESEND_DELIVERY_ENABLED = "false"
[[d1_databases]]
binding = "TRG_ORDERS"
database_id = "d92594e8-a45c-4f84-8f48-7c3aeba17f29"
[[r2_buckets]]
binding = "TRG_PRODUCTS"
bucket_name = "trg-products-staging"
[env.production.vars]
MARKETPLACE_WRITE_POLICY = "enabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "staging"
PUBLIC_SITE_ORIGIN = "https://tobacco-road-games-staging.pages.dev"
RESEND_DELIVERY_ENABLED = "true"
[[env.production.d1_databases]]
binding = "TRG_OFFICE"
database_id = "4c3ae60a-da41-4d65-aee5-a53179fc53f8"
[[env.production.d1_databases]]
binding = "TRG_ORDERS"
database_id = "d92594e8-a45c-4f84-8f48-7c3aeba17f29"
[[env.production.r2_buckets]]
binding = "TRG_FORUM_AVATARS"
bucket_name = "trg-forum-avatars-staging"
[[env.production.r2_buckets]]
binding = "TRG_OFFICE_ARCHIVE"
bucket_name = "trg-office-archive-staging"
[[env.production.r2_buckets]]
binding = "TRG_PRODUCTS"
bucket_name = "trg-products-staging"
`;

  const productionToml = `name = "tobacco-road-games"
[vars]
MARKETPLACE_WRITE_POLICY = "disabled"
NATIVE_GUEST_CHECKOUT_MODE = "disabled"
NATIVE_GUEST_CLAIM_MODE = "disabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "preview"
RESEND_DELIVERY_ENABLED = "false"
[env.production.vars]
MARKETPLACE_WRITE_POLICY = "enabled"
NATIVE_GUEST_CHECKOUT_MODE = "disabled"
NATIVE_GUEST_CLAIM_MODE = "disabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "production"
PUBLIC_SITE_ORIGIN = "https://tobaccoroadgames.com"
RESEND_DELIVERY_ENABLED = "false"
[[env.production.d1_databases]]
binding = "TRG_ORDERS"
database_id = "7e2cd675-a6f1-4fac-bbc9-03485a806c26"
[[env.production.r2_buckets]]
binding = "TRG_PRODUCTS"
bucket_name = "trg-products"
`;

  const previewToml = `name = "trg-member-tier-test-20261120"
[vars]
MARKETPLACE_WRITE_POLICY = "enabled"
NATIVE_GUEST_CHECKOUT_MODE = "disabled"
NATIVE_GUEST_CLAIM_MODE = "disabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "staging"
PUBLIC_SITE_ORIGIN = "https://trg-member-tier-test-20261120.pages.dev"
RESEND_DELIVERY_ENABLED = "false"
[[d1_databases]]
binding = "TRG_ORDERS"
database_id = "6248efe2-c96d-457e-b705-376cf5485c04"
[env.production.vars]
MARKETPLACE_WRITE_POLICY = "enabled"
NATIVE_GUEST_CHECKOUT_MODE = "disabled"
NATIVE_GUEST_CLAIM_MODE = "disabled"
NATIVE_LIVE_CHECKOUT_MODE = "disabled"
PAYMENT_PIPELINE_STAGE = "staging"
PUBLIC_SITE_ORIGIN = "https://trg-member-tier-test-20261120.pages.dev"
RESEND_DELIVERY_ENABLED = "false"
[[env.production.d1_databases]]
binding = "TRG_ORDERS"
database_id = "6248efe2-c96d-457e-b705-376cf5485c04"
`;

  assert.equal(pipeline.validateEnvironmentConfig(previewToml, "preview").ok, true, "isolated Preview map should pass");
  assert.equal(pipeline.validateEnvironmentConfig(stagingToml, "staging").ok, true, "staging map should pass");
  assert.equal(pipeline.validateEnvironmentConfig(productionToml, "production").ok, true, "production map should pass");

  const previewWithProdD1 = previewToml.replace("6248efe2-c96d-457e-b705-376cf5485c04", "7e2cd675-a6f1-4fac-bbc9-03485a806c26");
  assert.equal(pipeline.validateEnvironmentConfig(previewWithProdD1, "preview").ok, false, "Preview cannot bind production D1");
  const stageWithProdD1 = stagingToml.replace("d92594e8-a45c-4f84-8f48-7c3aeba17f29", "7e2cd675-a6f1-4fac-bbc9-03485a806c26");
  assert.equal(pipeline.validateEnvironmentConfig(stageWithProdD1, "staging").ok, false, "staging cannot bind production D1");
  const stageWithProdR2 = stagingToml.replace("trg-products-staging", "trg-products");
  assert.equal(pipeline.validateEnvironmentConfig(stageWithProdR2, "staging").ok, false, "staging cannot bind production R2");
  const productionWithStageD1 = productionToml.replace("7e2cd675-a6f1-4fac-bbc9-03485a806c26", "d92594e8-a45c-4f84-8f48-7c3aeba17f29");
  assert.equal(pipeline.validateEnvironmentConfig(productionWithStageD1, "production").ok, false, "production cannot bind staging D1");
  const productionWithStageR2 = productionToml.replace("bucket_name = \"trg-products\"", "bucket_name = \"trg-products-staging\"");
  assert.equal(pipeline.validateEnvironmentConfig(productionWithStageR2, "production").ok, false, "production cannot bind staging R2");
  assert.equal(pipeline.validateEnvironmentConfig(stagingToml, "production").ok, false, "wrong Pages project name must fail closed");
  assert.equal(pipeline.validateEnvironmentConfig(stagingToml.replace(/\[\[env\.production\.r2_buckets\]\][\s\S]*?bucket_name = "trg-products-staging"\n/, ""), "staging").ok, false, "missing expected binding must fail closed");
  assert.equal(pipeline.validateEnvironmentConfig(`${stagingToml}\n[[env.production.r2_buckets]]\nbinding = "EXTRA"\nbucket_name = "unexpected"\n`, "staging").ok, false, "unexpected binding must fail closed");

  assert.notEqual(environments.preview.deploymentBranch, environments.preview.projectProductionBranch, "Preview release branch must remain distinct from the production guard branch.");
  assert.equal(environments.staging.deploymentBranch, environments.staging.projectProductionBranch, "Staging promotion must use its configured production branch.");
  assert.equal(environments.production.deploymentBranch, environments.production.projectProductionBranch, "Production promotion must use its configured production branch.");
  const focusedMigration = migrationLedger.migrations.find((entry) => entry.id === "account-profile-072");
  assert.ok(focusedMigration, "Focused account/Profile migration must be listed in the release migration ledger.");
  assert.equal(focusedMigration.preconditions.numberedSchemaVersion, 72, "Migration ledger must record its expected pre-migration level.");
  assert.deepEqual(focusedMigration.preconditions.tables, ["users", "marketplace_creators"]);
  const migrationSha = crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, "..", focusedMigration.file))).digest("hex");
  assert.equal(migrationSha, focusedMigration.sha256, "Migration ledger hash must match the tracked SQL file.");
  assert.ok(focusedMigration.historicalVerification.staging.verifiedAt && focusedMigration.historicalVerification.production.verifiedAt, "Migration history should retain previously verified staging and production application.");

  const approval = { approved: true, commitSha: sha, deploymentId: "preview-id", previewUrl: "https://preview.trg-member-tier-test-20261120.pages.dev", manifestSha256: manifestSha };
  const stagingAttestation = {
    passed: true,
    commitSha: sha,
    manifestSha256: manifestSha,
    deploymentId: "staging-id",
    checks: Object.fromEntries(["registration", "immediateLogin", "customerAccess", "logout", "signedOutCustomerBlocked", "loginAfterLogout", "duplicateRegistrationRejected", "accountCleanup"].map((key) => [key, true]))
  };
  assert.equal(pipeline.validatePromotion({ target: "preview", commitSha: sha, remoteSha: sha }).ok, true, "clean pushed Preview candidate should pass");
  assert.equal(pipeline.validatePromotion({ target: "staging", commitSha: sha, remoteSha: sha, approval }).ok, true, "matching Owner approval gates staging");
  assert.equal(pipeline.validatePromotion({ target: "staging", commitSha: sha, remoteSha: sha, trackedDirty: true, approval }).ok, false, "dirty tracked worktree must block deployment");
  assert.equal(pipeline.validatePromotion({ target: "staging", commitSha: sha, remoteSha: "0".repeat(40), approval }).ok, false, "unpushed release branch must block deployment");
  assert.equal(pipeline.validatePromotion({ target: "staging", commitSha: sha, remoteSha: sha, approval: { ...approval, commitSha: "0".repeat(40) } }).ok, false, "stale Preview approval must block staging");
  assert.equal(pipeline.validatePromotion({ target: "production", commitSha: sha, remoteSha: sha, approval, stagingAttestation, rollbackDeploymentId: "previous-id" }).ok, true, "same approved and staging-tested SHA plus rollback should pass");
  assert.equal(pipeline.validatePromotion({ target: "production", commitSha: sha, remoteSha: sha, approval, stagingAttestation: { ...stagingAttestation, commitSha: "0".repeat(40) }, rollbackDeploymentId: "previous-id" }).ok, false, "different staging SHA must block production");
  assert.equal(pipeline.validatePromotion({ target: "production", commitSha: sha, remoteSha: sha, approval, stagingAttestation }).ok, false, "missing rollback deployment must block production");

  const manifest = { commitSha: sha, releaseId: "pipeline-test", sourceOutputSha256: "a".repeat(64) };
  const manifestBody = { schemaVersion: 1, ...manifest };
  const hashedManifest = { ...manifestBody, manifestSha256: crypto.createHash("sha256").update(JSON.stringify(manifestBody)).digest("hex") };
  assert.equal(pipeline.validateManifestHash(hashedManifest), true, "Manifest hash should verify against the exact manifest body.");
  assert.equal(pipeline.validateManifestHash({ ...hashedManifest, releaseId: "tampered" }), false, "Manifest edits must invalidate the stored manifest hash.");
  const deployment = { Environment: "Preview", Branch: "test", Source: sha.slice(0, 7) };
  const marker = { commitSha: sha, releaseId: "pipeline-test", sourceOutputSha256: manifest.sourceOutputSha256 };
  assert.equal(pipeline.validateDeploymentRecord({ target: "preview", manifest, deployment, publicMarker: marker }).ok, true, "Exact Preview deployment and full-SHA marker should pass.");
  assert.equal(pipeline.validateDeploymentRecord({ target: "preview", manifest, deployment: { ...deployment, Environment: "Production" }, publicMarker: marker }).ok, false, "Wrong deployment classification must fail.");
  assert.equal(pipeline.validateDeploymentRecord({ target: "preview", manifest, deployment, publicMarker: { ...marker, commitSha: "0".repeat(40) } }).ok, false, "Deployed marker with a different full SHA must fail.");

  const accountMigration = { id: "account-profile-072", sha256: focusedMigration.sha256, databaseIds: { staging: environments.staging.bindings.production.d1.TRG_ORDERS } };
  const migrationManifest = { commitSha: sha, manifestSha256: manifestSha, migrations: [accountMigration] };
  const migrationReceipt = { target: "staging", commitSha: sha, manifestSha256: manifestSha, verified: true, migrations: [{ id: accountMigration.id, sha256: accountMigration.sha256, databaseId: accountMigration.databaseIds.staging, postconditionsVerified: true }] };
  assert.equal(pipeline.validateMigrationReceipt(migrationReceipt, "staging", migrationManifest).ok, true, "Exact staging migration receipt should pass.");
  assert.equal(pipeline.validateMigrationReceipt({ ...migrationReceipt, migrations: [{ ...migrationReceipt.migrations[0], databaseId: environments.production.bindings.production.d1.TRG_ORDERS }] }, "staging", migrationManifest).ok, false, "Migration receipt bound to production D1 must fail staging promotion.");
  assert.equal(pipeline.validateMigrationReceipt({ ...migrationReceipt, commitSha: "0".repeat(40) }, "staging", migrationManifest).ok, false, "Migration receipt from a different SHA must fail.");

  const map = environments.secretPolicy;
  assert.deepEqual(map.nativeRegistrationAndLoginRequired, [], "native auth must not require provider secrets");
  assert.equal(map.googleAuthenticationRequired, false, "Google must not be a release requirement");
  assert.ok(map.optionalForPasswordResetEmail.every((name) => /^[A-Z0-9_]+$/.test(name)), "provider names are metadata only");
  assert.equal(pipeline.validateStagingChecks({ passed: true, commitSha: sha, manifestSha256: manifestSha, checks: Object.fromEntries(["registration", "immediateLogin", "customerAccess", "logout", "signedOutCustomerBlocked", "loginAfterLogout", "duplicateRegistrationRejected", "accountCleanup"].map((key) => [key, true])) }, { commitSha: sha, manifestSha256: manifestSha }).ok, true, "complete staging check set should pass");

  console.log("Release pipeline gates passed: environment isolation, immutable candidate, Preview approval, staging attestation, production SHA/rollback gate, and no email/Google secret requirement for native auth.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
