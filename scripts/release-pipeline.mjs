import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const WRANGLER_ROOT = path.join(REPOSITORY_ROOT, ".wrangler", "release-pipeline");
const ENVIRONMENT_FILE = path.join(REPOSITORY_ROOT, "ops", "release", "environments.json");
const MIGRATIONS_FILE = path.join(REPOSITORY_ROOT, "ops", "release", "migrations.json");
const CRITICAL_PAGES_FILES = Object.freeze([
  "index.html",
  "guest/index.html",
  "account.html",
  "customer.html",
  "customer-profile/index.html",
  "creator/index.html",
  "assets/css/member-profile.css",
  "assets/js/account.js"
]);
const REQUIRED_STAGING_CHECKS = Object.freeze([
  "registration",
  "immediateLogin",
  "customerAccess",
  "logout",
  "signedOutCustomerBlocked",
  "loginAfterLogout",
  "duplicateRegistrationRejected",
  "accountCleanup"
]);

export function parseWranglerConfig(text) {
  const tables = new Map();
  let section = "root";
  let currentRow = null;
  const root = { vars: {} };

  function finishRow() {
    if (currentRow) {
      if (!tables.has(section)) tables.set(section, []);
      tables.get(section).push(currentRow);
      currentRow = null;
    }
  }

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      finishRow();
      section = arrayTable[1].trim();
      currentRow = {};
      continue;
    }
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      finishRow();
      section = table[1].trim();
      if (section === "vars") root.vars = {};
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = parseTomlScalar(rawValue);
    if (currentRow) {
      currentRow[key] = value;
    } else if (section === "root") {
      root[key] = value;
    } else if (section === "vars") {
      root.vars[key] = value;
    } else if (section === "env.production.vars") {
      if (!root.productionVars) root.productionVars = {};
      root.productionVars[key] = value;
    } else if (section.startsWith("env.") && section.endsWith(".vars")) {
      const envName = section.split(".")[1];
      if (!root.environmentVars) root.environmentVars = {};
      if (!root.environmentVars[envName]) root.environmentVars[envName] = {};
      root.environmentVars[envName][key] = value;
    }
  }
  finishRow();

  const rows = (name) => tables.get(name) || [];
  const bindingsFor = (prefix = "") => ({
    d1: Object.fromEntries(rows(`${prefix}d1_databases`).map((row) => [String(row.binding || ""), String(row.database_id || "")])),
    r2: Object.fromEntries(rows(`${prefix}r2_buckets`).map((row) => [String(row.binding || ""), String(row.bucket_name || "")]))
  });
  root.bindings = {
    preview: bindingsFor(),
    production: bindingsFor("env.production.")
  };
  root.environments = {};
  for (const key of tables.keys()) {
    const match = key.match(/^env\.([^.]+)\.(d1_databases|r2_buckets)$/);
    if (!match) continue;
    const [, name] = match;
    root.environments[name] ||= { d1: {}, r2: {} };
    for (const row of tables.get(key)) {
      const binding = String(row.binding || "");
      const value = match[2] === "d1_databases" ? row.database_id : row.bucket_name;
      root.environments[name][match[2] === "d1_databases" ? "d1" : "r2"][binding] = String(value || "");
    }
  }
  return root;
}

function parseTomlScalar(value) {
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'")) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function validateEnvironmentConfig(configText, target, environmentMap = readJson(ENVIRONMENT_FILE)) {
  const errors = [];
  const expected = environmentMap?.[target];
  if (!expected) return { ok: false, errors: [`Unknown target environment: ${target}`] };
  const config = parseWranglerConfig(configText);
  if (config.name !== expected.projectName) {
    errors.push(`Pages project mismatch: expected ${expected.projectName}, received ${config.name || "missing"}.`);
  }
  for (const environmentName of ["preview", "production"]) {
    const actual = config.bindings[environmentName] || { d1: {}, r2: {} };
    const wanted = expected.bindings[environmentName];
    if (!wanted) {
      errors.push(`Environment map is missing ${target}.${environmentName} bindings.`);
      continue;
    }
    for (const type of ["d1", "r2"]) {
      if (!sameObject(actual[type], wanted[type])) {
        errors.push(`${environmentName} ${type.toUpperCase()} bindings do not exactly match the ${target} environment map.`);
      }
    }
    const actualVars = environmentName === "preview" ? config.vars : config.productionVars || {};
    for (const [key, value] of Object.entries(expected.vars?.[environmentName] || {})) {
      if (actualVars[key] !== value) {
        errors.push(`${environmentName} variable ${key} does not match the ${target} environment map.`);
      }
    }
  }
  if (target === "preview" || target === "staging") {
    const values = [...Object.values(config.vars || {}), ...Object.values(config.productionVars || {})].map(String);
    if (values.some((value) => /tobaccoroadgames\.com/i.test(value))) {
      errors.push(`${target} config contains a production website origin.`);
    }
    if (values.some((value) => value === "trg-products")) {
      errors.push(`${target} config contains the production products bucket.`);
    }
  }
  return { ok: errors.length === 0, errors, projectName: config.name, config };
}

export function validatePromotion({ target, trackedDirty = false, commitSha, remoteSha, approval, stagingAttestation, rollbackDeploymentId }) {
  const errors = [];
  if (!commitSha || !/^[a-f0-9]{40}$/i.test(commitSha)) errors.push("Candidate must use a full 40-character Git SHA.");
  if (trackedDirty) errors.push("Tracked working-tree changes block release promotion.");
  if (!remoteSha || remoteSha.toLowerCase() !== String(commitSha || "").toLowerCase()) {
    errors.push("The release branch must be pushed to origin at the exact candidate SHA.");
  }
  if (target === "staging" || target === "production") {
    if (!approval?.approved || approval.commitSha !== commitSha) errors.push("Owner Preview approval is missing or belongs to a different SHA.");
    if (!approval?.deploymentId || !approval?.previewUrl || !approval?.manifestSha256) errors.push("Owner Preview approval is missing its deployment, URL, or manifest fingerprint.");
  }
  if (target === "production") {
    if (!stagingAttestation?.passed || stagingAttestation.commitSha !== commitSha) errors.push("A passing staging attestation for this exact SHA is required.");
    if (!stagingAttestation?.deploymentId || stagingAttestation.manifestSha256 !== approval?.manifestSha256) {
      errors.push("Staging deployment and Preview manifest must identify the same release.");
    }
    if (!rollbackDeploymentId) errors.push("A previous production deployment must be recorded before promotion.");
  }
  if (!["preview", "staging", "production"].includes(target)) errors.push(`Unknown promotion target: ${target}`);
  return { ok: errors.length === 0, errors };
}

export function validateDeploymentRecord({ target, manifest, deployment, publicMarker }) {
  const expected = readJson(ENVIRONMENT_FILE)[target];
  const errors = [];
  if (!expected) errors.push(`Unknown deployment target: ${target}`);
  if (!deployment) errors.push("Deployment ID was not found in the Pages deployment list.");
  if (deployment && deployment.Environment !== expected?.deploymentEnvironment) errors.push("Pages deployment environment does not match the target.");
  if (deployment && deployment.Branch !== expected?.deploymentBranch) errors.push("Pages deployment branch does not match the target.");
  if (deployment && !String(deployment.Source || "").startsWith(String(manifest.commitSha || "").slice(0, 7))) {
    errors.push("Pages deployment source SHA prefix does not match the release manifest.");
  }
  if (publicMarker?.commitSha !== manifest.commitSha) errors.push("Deployed trg-release.json does not report the full release SHA.");
  if (publicMarker?.releaseId !== manifest.releaseId) errors.push("Deployed trg-release.json has a different release ID.");
  if (publicMarker?.sourceOutputSha256 !== manifest.sourceOutputSha256) errors.push("Deployed static build fingerprint does not match the release manifest.");
  return { ok: errors.length === 0, errors };
}

export function validateStagingChecks(checks, manifest) {
  const errors = [];
  if (checks?.commitSha !== manifest.commitSha) errors.push("Staging checks belong to a different release SHA.");
  if (checks?.manifestSha256 !== manifest.manifestSha256) errors.push("Staging checks belong to a different build manifest.");
  for (const name of REQUIRED_STAGING_CHECKS) {
    if (checks?.checks?.[name] !== true) errors.push(`Staging check did not pass: ${name}.`);
  }
  if (checks?.passed !== true) errors.push("Staging attestation must explicitly record passed=true.");
  return { ok: errors.length === 0, errors };
}

export function validateMigrationReceipt(receipt, target, manifest) {
  const errors = [];
  if (!receipt) return { ok: false, errors: [`${target} migration verification receipt is missing.`] };
  if (receipt.target !== target) errors.push("Migration receipt target does not match the promotion target.");
  if (receipt.commitSha !== manifest.commitSha) errors.push("Migration receipt belongs to a different release SHA.");
  if (receipt.manifestSha256 !== manifest.manifestSha256) errors.push("Migration receipt belongs to a different release manifest.");
  if (receipt.verified !== true) errors.push("Migration receipt must record verified=true.");
  for (const migration of manifest.migrations || []) {
    const expectedDatabaseId = migration.databaseIds?.[target];
    const applied = receipt.migrations?.find((item) => item.id === migration.id);
    if (!expectedDatabaseId) errors.push(`Manifest has no ${target} database target for migration ${migration.id}.`);
    if (!applied) {
      errors.push(`Migration receipt is missing ${migration.id}.`);
      continue;
    }
    if (applied.sha256 !== migration.sha256) errors.push(`Migration receipt hash differs for ${migration.id}.`);
    if (applied.databaseId !== expectedDatabaseId) errors.push(`Migration receipt targets the wrong ${target} D1 for ${migration.id}.`);
    if (applied.postconditionsVerified !== true) errors.push(`Migration postconditions were not verified for ${migration.id}.`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateManifestHash(manifest) {
  if (!manifest || typeof manifest !== "object" || typeof manifest.manifestSha256 !== "string") return false;
  const { manifestSha256, ...body } = manifest;
  return hashJson(body) === manifestSha256;
}

export function hashDirectory(directory) {
  const files = collectFiles(directory);
  return hashJson(files);
}

function collectFiles(directory, root = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in a release artifact: ${candidate}`);
    if (entry.isDirectory()) files.push(...collectFiles(candidate, root));
    else if (entry.isFile()) {
      files.push({ path: path.relative(root, candidate).split(path.sep).join("/"), sha256: hashFile(candidate) });
    }
  }
  return files;
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameObject(actual, expected) {
  const sort = (value) => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sort(actual)) === JSON.stringify(sort(expected));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function git(args) {
  return execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
}

function installReleaseDependencies(sourceRoot) {
  const npmArguments = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, ...npmArguments], { cwd: sourceRoot, stdio: "inherit" });
    return;
  }
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm ${npmArguments.join(" ")}`], { cwd: sourceRoot, stdio: "inherit" });
    return;
  }
  execFileSync("npm", npmArguments, { cwd: sourceRoot, stdio: "inherit" });
}

function runBuild(argv) {
  const args = parseArgs(argv);
  const ref = required(args, "ref");
  const releaseBranch = required(args, "release-branch");
  const releaseId = required(args, "release-id");
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(releaseId)) throw new Error("Release ID must be a short alphanumeric label with dots, underscores, or hyphens.");
  if (!releaseBranch.startsWith("release/")) throw new Error("Release builds must name a release/* branch.");
  const status = git(["status", "--porcelain=v1", "--untracked-files=no"]);
  if (status) throw new Error("Tracked working-tree changes block release builds.");
  const commitSha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  const localBranchSha = git(["rev-parse", "--verify", `refs/heads/${releaseBranch}`]);
  if (localBranchSha !== commitSha) throw new Error("The release branch must point to the requested candidate commit.");
  const remoteLine = git(["ls-remote", "--heads", "origin", `refs/heads/${releaseBranch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  if (remoteSha !== commitSha) throw new Error("The release branch must be pushed to origin at the requested candidate commit.");

  const releaseRoot = path.join(WRANGLER_ROOT, releaseId);
  if (fs.existsSync(releaseRoot)) throw new Error(`Release workspace already exists; choose a new release ID: ${releaseRoot}`);
  const sourceRoot = path.join(releaseRoot, "source");
  const archiveFile = path.join(releaseRoot, "source.tar");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(archiveFile, execFileSync("git", ["archive", "--format=tar", commitSha], { cwd: REPOSITORY_ROOT, maxBuffer: 256 * 1024 * 1024 }));
  execFileSync("tar", ["-xf", archiveFile, "-C", sourceRoot], { cwd: REPOSITORY_ROOT, stdio: "inherit" });
  fs.unlinkSync(archiveFile);

  if (!fs.existsSync(path.join(sourceRoot, "package-lock.json"))) throw new Error("A committed package-lock.json is required for a reproducible release build.");
  installReleaseDependencies(sourceRoot);

  const outputDirectory = path.join(sourceRoot, ".wrangler", "release-pages-output");
  execFileSync(process.execPath, [path.join(sourceRoot, "scripts", "build-pages-output.mjs"), "--output", outputDirectory], { cwd: sourceRoot, stdio: "inherit" });
  const createdAt = new Date().toISOString();
  const sourceFiles = collectFiles(outputDirectory);
  const sourceOutputSha256 = hashJson(sourceFiles);
  fs.writeFileSync(path.join(outputDirectory, "trg-release.json"), `${JSON.stringify({ schemaVersion: 1, releaseId, commitSha, releaseBranch, generatedAt: createdAt, sourceOutputSha256 }, null, 2)}\n`);
  const pagesFiles = collectFiles(outputDirectory);
  const criticalAssets = Object.fromEntries(CRITICAL_PAGES_FILES.map((relative) => {
    const candidate = path.join(outputDirectory, relative);
    if (!fs.existsSync(candidate)) throw new Error(`Release-critical Pages asset is missing: ${relative}`);
    return [relative, hashFile(candidate)];
  }));
  criticalAssets["trg-release.json"] = hashFile(path.join(outputDirectory, "trg-release.json"));
  const packageLock = path.join(sourceRoot, "package-lock.json");
  const migrationLedger = readJson(MIGRATIONS_FILE);
  const migrationIds = args.get("migration") || [];
  const migrations = migrationIds.map((id) => {
    const entry = migrationLedger.migrations.find((item) => item.id === id);
    if (!entry) throw new Error(`Migration is missing from ops/release/migrations.json: ${id}`);
    const candidate = path.join(sourceRoot, entry.file);
    if (!fs.existsSync(candidate) || hashFile(candidate) !== entry.sha256) throw new Error(`Migration file hash does not match the release ledger: ${id}`);
    const databaseIds = Object.fromEntries(["preview", "staging", "production"].map((target) => {
      const environmentName = target === "preview" ? "preview" : "production";
      const databaseId = readJson(ENVIRONMENT_FILE)[target]?.bindings?.[environmentName]?.d1?.[entry.databaseBinding];
      if (!databaseId) throw new Error(`Migration ${id} has no ${target} database binding ${entry.databaseBinding}.`);
      return [target, databaseId];
    }));
    return { id: entry.id, file: entry.file, sha256: entry.sha256, databaseBinding: entry.databaseBinding, databaseIds, baseline: entry.baseline, preconditions: entry.preconditions, postconditions: entry.postconditions };
  });
  const functionsSourceSha256 = hashJson(collectFiles(path.join(sourceRoot, "functions")));
  const policySha = git(["rev-parse", "HEAD"]);
  const body = {
    schemaVersion: 1,
    releaseId,
    commitSha,
    releaseBranch,
    commitMessage: git(["show", "-s", "--format=%s", commitSha]),
    createdAt,
    buildCommand: `npm run release:build -- --ref ${commitSha} --release-branch ${releaseBranch} --release-id ${releaseId}${migrationIds.length ? ` --migration ${migrationIds.join(" --migration ")}` : ""}`,
    pipelinePolicySha: policySha,
    pagesFileCount: pagesFiles.length,
    sourceOutputSha256,
    pagesOutputSha256: hashJson(pagesFiles),
    criticalAssets,
    functionsSourceSha256,
    packageLockSha256: fs.existsSync(packageLock) ? hashFile(packageLock) : null,
    migrations,
    artifact: {
      sourceRoot: path.relative(REPOSITORY_ROOT, sourceRoot).split(path.sep).join("/"),
      pagesOutput: path.relative(REPOSITORY_ROOT, outputDirectory).split(path.sep).join("/")
    }
  };
  const manifestSha256 = hashJson(body);
  const manifest = { ...body, manifestSha256 };
  fs.writeFileSync(path.join(releaseRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ releaseId, commitSha, pagesFileCount: pagesFiles.length, pagesOutputSha256: manifest.pagesOutputSha256, functionsSourceSha256, manifestSha256, artifact: body.artifact }, null, 2));
}

function runCheckEnvironment(argv) {
  const args = parseArgs(argv);
  const target = required(args, "target");
  const configPath = path.resolve(REPOSITORY_ROOT, required(args, "config"));
  const result = validateEnvironmentConfig(fs.readFileSync(configPath, "utf8"), target);
  console.log(JSON.stringify({ target, projectName: result.projectName, ok: result.ok, errors: result.errors }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function verifyArtifact(releaseId) {
  const releaseRoot = path.join(WRANGLER_ROOT, releaseId);
  const manifest = readJson(path.join(releaseRoot, "manifest.json"));
  const sourceRoot = path.resolve(REPOSITORY_ROOT, manifest.artifact.sourceRoot);
  const outputDirectory = path.resolve(REPOSITORY_ROOT, manifest.artifact.pagesOutput);
  const errors = [];
  if (!validateManifestHash(manifest)) errors.push("Release manifest content does not match its SHA-256 fingerprint.");
  if (!sourceRoot.startsWith(`${releaseRoot}${path.sep}`) || !outputDirectory.startsWith(`${sourceRoot}${path.sep}`)) errors.push("Release artifact paths escaped the ignored release workspace.");
  if (hashDirectory(outputDirectory) !== manifest.pagesOutputSha256) errors.push("Pages output hash differs from the release manifest.");
  if (hashJson(collectFiles(path.join(sourceRoot, "functions"))) !== manifest.functionsSourceSha256) errors.push("Pages Functions source hash differs from the release manifest.");
  if (manifest.packageLockSha256 && hashFile(path.join(sourceRoot, "package-lock.json")) !== manifest.packageLockSha256) errors.push("Package lock hash differs from the release manifest.");
  for (const migration of manifest.migrations || []) {
    const sourceMigration = path.resolve(sourceRoot, migration.file);
    if (!sourceMigration.startsWith(`${sourceRoot}${path.sep}`) || !fs.existsSync(sourceMigration)) {
      errors.push(`Migration path is missing or outside the release archive: ${migration.id}.`);
      continue;
    }
    if (hashFile(sourceMigration) !== migration.sha256) errors.push(`Migration SQL hash differs from the release manifest: ${migration.id}.`);
  }
  const marker = readJson(path.join(outputDirectory, "trg-release.json"));
  if (marker.commitSha !== manifest.commitSha || marker.releaseId !== manifest.releaseId || marker.sourceOutputSha256 !== manifest.sourceOutputSha256) {
    errors.push("Release marker does not match the release manifest.");
  }
  return { manifest, sourceRoot, outputDirectory, errors, ok: errors.length === 0 };
}

function runVerifyArtifact(argv) {
  const args = parseArgs(argv);
  const result = verifyArtifact(required(args, "release-id"));
  console.log(JSON.stringify({ releaseId: result.manifest.releaseId, commitSha: result.manifest.commitSha, pagesFileCount: result.manifest.pagesFileCount, manifestSha256: result.manifest.manifestSha256, ok: result.ok, errors: result.errors }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function runCheckPromotion(argv) {
  const args = parseArgs(argv);
  const target = required(args, "target");
  const releaseId = required(args, "release-id");
  const result = verifyArtifact(releaseId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const status = git(["status", "--porcelain=v1", "--untracked-files=no"]);
  const remoteLine = git(["ls-remote", "--heads", "origin", `refs/heads/${result.manifest.releaseBranch}`]);
  const remoteSha = remoteLine.split(/\s+/)[0] || "";
  const approvalPath = path.join(WRANGLER_ROOT, releaseId, "owner-approval.json");
  const stagingPath = path.join(WRANGLER_ROOT, releaseId, "staging-attestation.json");
  const rollbackPath = path.join(WRANGLER_ROOT, releaseId, "rollback-snapshot.json");
  const migrationPath = path.join(WRANGLER_ROOT, releaseId, `${target}-migrations.json`);
  const approval = fs.existsSync(approvalPath) ? readJson(approvalPath) : null;
  const staging = fs.existsSync(stagingPath) ? readJson(stagingPath) : null;
  const rollback = fs.existsSync(rollbackPath) ? readJson(rollbackPath) : null;
  const gate = validatePromotion({
    target,
    trackedDirty: Boolean(status),
    commitSha: result.manifest.commitSha,
    remoteSha,
    approval: approval && { ...approval, manifestSha256: approval.manifestSha256 },
    stagingAttestation: staging,
    rollbackDeploymentId: rollback?.deploymentId
  });
  if ((target === "staging" || target === "production") && approval?.manifestSha256 !== result.manifest.manifestSha256) {
    gate.errors.push("Owner Preview approval manifest does not match the candidate artifact.");
  }
  if (target === "production" && staging?.manifestSha256 !== result.manifest.manifestSha256) {
    gate.errors.push("Staging attestation manifest does not match the candidate artifact.");
  }
  if ((result.manifest.migrations || []).length) {
    const receipt = fs.existsSync(migrationPath) ? readJson(migrationPath) : null;
    if (receipt || !args.has("preflight")) {
      const migrationGate = validateMigrationReceipt(receipt, target, result.manifest);
      gate.errors.push(...migrationGate.errors);
    }
  }
  console.log(JSON.stringify({ target, releaseId, commitSha: result.manifest.commitSha, manifestSha256: result.manifest.manifestSha256, ok: gate.ok, errors: gate.errors }, null, 2));
  if (!gate.ok) process.exitCode = 1;
}

async function runApprovePreview(argv) {
  const args = parseArgs(argv);
  const releaseId = required(args, "release-id");
  const deploymentId = required(args, "deployment-id");
  const approvedBy = required(args, "approved-by");
  const deploymentFile = path.resolve(REPOSITORY_ROOT, required(args, "deployment-list"));
  const result = verifyArtifact(releaseId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const list = readJson(deploymentFile);
  const deployment = findDeployment(list, deploymentId);
  const marker = await fetchReleaseMarker(deployment?.Deployment);
  const gate = validateDeploymentRecord({ target: "preview", manifest: result.manifest, deployment, publicMarker: marker });
  if (!gate.ok) throw new Error(gate.errors.join("\n"));
  const expected = readJson(ENVIRONMENT_FILE).preview;
  const previewHostSuffix = new URL(expected.publicOrigin).hostname;
  if (!new URL(deployment.Deployment).hostname.endsWith(`.${previewHostSuffix}`)) {
    throw new Error("Preview deployment URL does not match the isolated Preview project.");
  }
  if (approvalPathAlreadyExists(releaseId)) throw new Error("An approval already exists for this release ID; a new SHA needs a new release ID and approval.");
  const approval = {
    approved: true,
    approvedBy,
    approvedAt: args.get("approved-at") || new Date().toISOString(),
    projectName: expected.projectName,
    deploymentId,
    previewUrl: deployment.Deployment,
    commitSha: result.manifest.commitSha,
    manifestSha256: result.manifest.manifestSha256
  };
  fs.writeFileSync(path.join(WRANGLER_ROOT, releaseId, "owner-approval.json"), `${JSON.stringify(approval, null, 2)}\n`);
  console.log(JSON.stringify({ recorded: true, deploymentId, commitSha: approval.commitSha, manifestSha256: approval.manifestSha256 }, null, 2));
}

async function runRecordDeployment(argv) {
  const args = parseArgs(argv);
  const target = required(args, "target");
  const releaseId = required(args, "release-id");
  const deploymentId = required(args, "deployment-id");
  const deploymentFile = path.resolve(REPOSITORY_ROOT, required(args, "deployment-list"));
  const result = verifyArtifact(releaseId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const deployment = findDeployment(readJson(deploymentFile), deploymentId);
  const marker = await fetchReleaseMarker(deployment?.Deployment);
  const gate = validateDeploymentRecord({ target, manifest: result.manifest, deployment, publicMarker: marker });
  if (!gate.ok) throw new Error(gate.errors.join("\n"));
  const record = {
    target,
    projectName: readJson(ENVIRONMENT_FILE)[target].projectName,
    deploymentId,
    deploymentUrl: deployment.Deployment,
    deploymentEnvironment: deployment.Environment,
    branch: deployment.Branch,
    commitSha: result.manifest.commitSha,
    manifestSha256: result.manifest.manifestSha256,
    staticOutputSha256: result.manifest.pagesOutputSha256,
    verifiedAt: new Date().toISOString()
  };
  const file = path.join(WRANGLER_ROOT, releaseId, `${target}-deployment.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ recorded: true, ...record }, null, 2));
}

function runRecordStagingAttestation(argv) {
  const args = parseArgs(argv);
  const releaseId = required(args, "release-id");
  const deploymentId = required(args, "deployment-id");
  const checksFile = path.resolve(REPOSITORY_ROOT, required(args, "checks-file"));
  const result = verifyArtifact(releaseId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const checks = readJson(checksFile);
  const checkResult = validateStagingChecks(checks, result.manifest);
  if (!checkResult.ok) throw new Error(checkResult.errors.join("\n"));
  const deploymentPath = path.join(WRANGLER_ROOT, releaseId, "staging-deployment.json");
  if (!fs.existsSync(deploymentPath)) throw new Error("Staging deployment metadata must be verified before recording checks.");
  const deployment = readJson(deploymentPath);
  if (deployment.deploymentId !== deploymentId || deployment.commitSha !== result.manifest.commitSha || deployment.manifestSha256 !== result.manifest.manifestSha256) {
    throw new Error("Staging checks do not match the verified staging deployment.");
  }
  const attestation = {
    passed: true,
    commitSha: result.manifest.commitSha,
    manifestSha256: result.manifest.manifestSha256,
    deploymentId,
    deploymentUrl: deployment.deploymentUrl,
    verifiedAt: checks.verifiedAt || new Date().toISOString(),
    checks: checks.checks
  };
  fs.writeFileSync(path.join(WRANGLER_ROOT, releaseId, "staging-attestation.json"), `${JSON.stringify(attestation, null, 2)}\n`);
  console.log(JSON.stringify({ recorded: true, releaseId, deploymentId, commitSha: attestation.commitSha, passed: true }, null, 2));
}

function runFinalizeRecord(argv) {
  const args = parseArgs(argv);
  const releaseId = required(args, "release-id");
  const releaseRoot = path.join(WRANGLER_ROOT, releaseId);
  const verified = verifyArtifact(releaseId);
  if (!verified.ok) throw new Error(verified.errors.join("\n"));
  const load = (name) => readJson(path.join(releaseRoot, name));
  const preview = load("preview-deployment.json");
  const approval = load("owner-approval.json");
  const staging = load("staging-deployment.json");
  const stagingChecks = load("staging-attestation.json");
  const production = load("production-deployment.json");
  const productionChecks = load("production-checks.json");
  const rollback = load("rollback-snapshot.json");
  if (preview.commitSha !== verified.manifest.commitSha || approval.commitSha !== verified.manifest.commitSha || staging.commitSha !== verified.manifest.commitSha || production.commitSha !== verified.manifest.commitSha) {
    throw new Error("Release record inputs do not all refer to one source SHA.");
  }
  if (!stagingChecks.passed || stagingChecks.commitSha !== verified.manifest.commitSha || !productionChecks.passed || productionChecks.commitSha !== verified.manifest.commitSha) {
    throw new Error("Both staging and production focused checks must pass before writing a completed release record.");
  }
  const migrationReceipts = {};
  for (const target of ["staging", "production"]) {
    const receiptPath = path.join(releaseRoot, `${target}-migrations.json`);
    if ((verified.manifest.migrations || []).length) {
      if (!fs.existsSync(receiptPath)) throw new Error(`${target} migration verification receipt is missing.`);
      const receipt = readJson(receiptPath);
      const result = validateMigrationReceipt(receipt, target, verified.manifest);
      if (!result.ok) throw new Error(result.errors.join("\n"));
      migrationReceipts[target] = receipt;
    }
  }
  const record = {
    schemaVersion: 1,
    releaseId,
    releaseSha: verified.manifest.commitSha,
    releaseBranch: verified.manifest.releaseBranch,
    manifestSha256: verified.manifest.manifestSha256,
    releaseManifest: verified.manifest,
    build: {
      createdAt: verified.manifest.createdAt,
      buildCommand: verified.manifest.buildCommand,
      pagesFileCount: verified.manifest.pagesFileCount,
      pagesOutputSha256: verified.manifest.pagesOutputSha256,
      functionsSourceSha256: verified.manifest.functionsSourceSha256,
      packageLockSha256: verified.manifest.packageLockSha256,
      criticalAssets: verified.manifest.criticalAssets
    },
    preview: { ...preview, ownerApproval: approval },
    staging: { ...staging, verification: stagingChecks },
    production: { ...production, verification: productionChecks, rollbackDeployment: rollback },
    migrations: verified.manifest.migrations.map((item) => ({
      ...item,
      appliedTo: {
        staging: migrationReceipts.staging?.migrations?.find((entry) => entry.id === item.id) || null,
        production: migrationReceipts.production?.migrations?.find((entry) => entry.id === item.id) || null
      }
    })),
    completedAt: new Date().toISOString()
  };
  const outputDirectory = path.join(REPOSITORY_ROOT, "ops", "releases", "records");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${releaseId}.json`);
  if (fs.existsSync(outputPath)) throw new Error(`Release record already exists: ${outputPath}`);
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ record: path.relative(REPOSITORY_ROOT, outputPath).split(path.sep).join("/"), releaseSha: record.releaseSha, manifestSha256: record.manifestSha256 }, null, 2));
}

function approvalPathAlreadyExists(releaseId) {
  return fs.existsSync(path.join(WRANGLER_ROOT, releaseId, "owner-approval.json"));
}

async function runVerifyDeployment(argv) {
  const args = parseArgs(argv);
  const target = required(args, "target");
  const releaseId = required(args, "release-id");
  const deploymentId = required(args, "deployment-id");
  const deploymentFile = path.resolve(REPOSITORY_ROOT, required(args, "deployment-list"));
  const result = verifyArtifact(releaseId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const deployment = findDeployment(readJson(deploymentFile), deploymentId);
  const marker = await fetchReleaseMarker(deployment?.Deployment);
  const gate = validateDeploymentRecord({ target, manifest: result.manifest, deployment, publicMarker: marker });
  console.log(JSON.stringify({ target, deploymentId, commitSha: result.manifest.commitSha, manifestSha256: result.manifest.manifestSha256, ok: gate.ok, errors: gate.errors }, null, 2));
  if (!gate.ok) process.exitCode = 1;
}

async function fetchReleaseMarker(deploymentUrl) {
  if (!deploymentUrl) return null;
  const response = await fetch(new URL("/trg-release.json", deploymentUrl), { cache: "no-store", redirect: "error" });
  if (!response.ok) return null;
  return response.json();
}

function findDeployment(list, id) {
  if (!Array.isArray(list)) throw new Error("Wrangler Pages deployment list must be a JSON array.");
  return list.find((item) => item.Id === id) || null;
}

function parseArgs(argv) {
  const result = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    if (key === "migration") {
      result.set(key, [...(result.get(key) || []), argv[++i]]);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      result.set(key, argv[++i]);
    } else {
      result.set(key, true);
    }
  }
  return result;
}

function required(args, key) {
  const value = args.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required --${key} value.`);
  return value;
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === "build") return runBuild(argv);
  if (command === "check-environment") return runCheckEnvironment(argv);
  if (command === "verify-artifact") return runVerifyArtifact(argv);
  if (command === "check-promotion") return runCheckPromotion(argv);
  if (command === "approve-preview") return runApprovePreview(argv);
  if (command === "record-deployment") return runRecordDeployment(argv);
  if (command === "record-staging-attestation") return runRecordStagingAttestation(argv);
  if (command === "finalize-record") return runFinalizeRecord(argv);
  if (command === "verify-deployment") return runVerifyDeployment(argv);
  throw new Error("Usage: release-pipeline.mjs <build|check-environment|verify-artifact|check-promotion|approve-preview|record-deployment|verify-deployment> [options]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main()).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
