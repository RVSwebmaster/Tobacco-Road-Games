import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
const wranglerDirectory = path.join(repositoryRoot, ".wrangler");

export const publicRootFiles = Object.freeze([
  "_redirects", "_routes.json", "404.html", "account.html", "ad-depot.html", "ai-policy.html", "customer.html",
  "authors.html", "index.html", "robots.txt", "sitemap.xml", "styles.css", "support.html",
]);

export const publicDirectories = Object.freeze([
  "assets", "authors", "admin-profile", "creator", "creator-dashboard", "creators", "customer-profile", "dashboard", "data", "founding-25-profile", "guest", "launch-week", "media", "owner-profile", "premium-creator-profile",
  "office", "owner", "shared", "store",
]);

export const excludedPublicFiles = Object.freeze([
  "media/ads/README.md", "owner/downloads/README.md",
]);

const FULL_GIT_SHA = /^[a-f0-9]{40}$/i;

function assertSafeOutputDirectory(outputDirectory) {
  const resolved = path.resolve(outputDirectory);
  if (path.dirname(resolved) !== wranglerDirectory || !path.basename(resolved).endsWith("pages-output")) {
    throw new Error(`Pages output must be a dedicated *pages-output directory directly beneath ${wranglerDirectory}.`);
  }
  return resolved;
}

function assertSourcePath(relativePath) {
  const source = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Required public source is missing: ${relativePath}`);
  return source;
}

function countFiles(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Pages output: ${candidate}`);
    if (entry.isDirectory()) count += countFiles(candidate);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export function buildPagesOutput(outputDirectory = path.join(wranglerDirectory, "production-pages-output"), buildMetadata = {}) {
  const resolvedOutput = assertSafeOutputDirectory(outputDirectory);
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  fs.mkdirSync(resolvedOutput, { recursive: true });

  for (const relativePath of publicRootFiles) {
    fs.copyFileSync(assertSourcePath(relativePath), path.join(resolvedOutput, relativePath));
  }
  for (const relativePath of publicDirectories) {
    fs.cpSync(assertSourcePath(relativePath), path.join(resolvedOutput, relativePath), {
      recursive: true, errorOnExist: true, force: false,
    });
  }
  for (const relativePath of excludedPublicFiles) fs.rmSync(path.join(resolvedOutput, relativePath), { force: true });

  for (const forbiddenPath of ["tmp", "videos", "node_modules", ".git", ".dev.vars"]) {
    if (fs.existsSync(path.join(resolvedOutput, forbiddenPath))) {
      throw new Error(`Forbidden local content entered Pages output: ${forbiddenPath}`);
    }
  }
  for (const requiredPath of ["index.html", "store/index.html"]) {
    if (!fs.existsSync(path.join(resolvedOutput, requiredPath))) {
      throw new Error(`Required Pages output is missing: ${requiredPath}`);
    }
  }
  assertSourcePath("functions");
  const sourceOutputSha256 = hashPagesSourceOutput(resolvedOutput);
  const commitSha = buildMetadata.commitSha ?? process.env.CF_PAGES_COMMIT_SHA;
  if (commitSha) {
    if (!FULL_GIT_SHA.test(commitSha)) throw new Error("CF_PAGES_COMMIT_SHA must contain a full Git SHA.");
    const branch = buildMetadata.branch ?? process.env.CF_PAGES_BRANCH;
    if (!branch) throw new Error("CF_PAGES_BRANCH is required to record the Cloudflare Pages source marker.");
    fs.writeFileSync(path.join(resolvedOutput, "trg-release.json"), `${JSON.stringify({
      schemaVersion: 1,
      commitSha,
      branch,
      buildProvider: "cloudflare-pages",
      generatedAt: new Date().toISOString(),
      sourceOutputSha256,
    }, null, 2)}\n`);
  }
  return { outputDirectory: resolvedOutput, fileCount: countFiles(resolvedOutput), sourceOutputSha256 };
}

export function hashPagesSourceOutput(directory) {
  const files = collectPagesFiles(directory);
  return crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function collectPagesFiles(directory, root = directory) {
  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Pages output: ${candidate}`);
    if (entry.isDirectory()) files.push(...collectPagesFiles(candidate, root));
    else if (entry.isFile()) {
      if (candidate === path.join(root, "trg-release.json")) continue;
      files.push({
        path: path.relative(root, candidate).split(path.sep).join("/"),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex"),
      });
    }
  }
  return files;
}

function parseOutputArgument(argv) {
  if (argv.length === 0) return undefined;
  if (argv.length === 2 && argv[0] === "--output") return argv[1];
  throw new Error("Usage: node scripts/build-pages-output.mjs [--output <.wrangler/*-pages-output>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildPagesOutput(parseOutputArgument(process.argv.slice(2)));
  console.log(`Prepared ${result.fileCount} allowlisted Pages files in ${path.relative(repositoryRoot, result.outputDirectory)}.`);
}
