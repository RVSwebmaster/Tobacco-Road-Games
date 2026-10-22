import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
const wranglerDirectory = path.join(repositoryRoot, ".wrangler");

export const publicRootFiles = Object.freeze([
  "_routes.json", "404.html", "account.html", "ad-depot.html", "ai-policy.html",
  "authors.html", "index.html", "robots.txt", "sitemap.xml", "styles.css", "support.html",
]);

export const publicDirectories = Object.freeze([
  "assets", "authors", "creator", "creators", "data", "launch-week", "media",
  "office", "owner", "preview", "shared", "store",
]);

export const excludedPublicFiles = Object.freeze([
  "media/ads/README.md", "owner/downloads/README.md",
]);

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

export function buildPagesOutput(outputDirectory = path.join(wranglerDirectory, "production-pages-output")) {
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
  return { outputDirectory: resolvedOutput, fileCount: countFiles(resolvedOutput) };
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
