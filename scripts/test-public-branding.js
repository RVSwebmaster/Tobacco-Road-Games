const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", ".wrangler", "node_modules", "owner", "office", "assets", "data", "shared"]);
const BRAND_ABBREVIATION = /\bTRG\b/i;
const MACHINE_TOKEN = /^TRG(?:[_:./-][A-Z0-9_$./:-]+)$/i;

function findPublicAbbreviation(value) {
  const text = String(value || "").trim();
  return BRAND_ABBREVIATION.test(text) && !MACHINE_TOKEN.test(text);
}

function assertPublicCopy(text, source) {
  if (findPublicAbbreviation(text)) {
    throw new Error(`${source}: public-facing copy must spell out Tobacco Road Games: ${JSON.stringify(text)}`);
  }
}

function walk(directory, skipDirs = SKIP_DIRS) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, skipDirs));
    else files.push(absolute);
  }
  return files;
}

function publicHtmlCopy(html) {
  const copy = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  const attributes = [...String(html).matchAll(/\b(?:alt|title|aria-label|placeholder|value|content|label)\s*=\s*(["'])(.*?)\1/gi)]
    .map((match) => match[2]);
  return [copy, ...attributes];
}

function publicScriptStrings(source) {
  return [...String(source).matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g)]
    .map((match) => match[0].slice(1, -1).replace(/\\([\\'"`])/g, "$1"));
}

function jsonStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => jsonStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => jsonStrings(item, output));
  return output;
}

async function main() {
  assert.equal(findPublicAbbreviation("Tobacco Road Games Creator Intake"), false);
  assert.equal(findPublicAbbreviation("Tobacco Road Games"), false);
  assert.equal(findPublicAbbreviation("TRG reads your PDF"), true);
  assert.equal(findPublicAbbreviation("TRG_ORDERS"), false, "Internal binding identifiers are outside the public-copy rule.");
  assert.equal(findPublicAbbreviation("trg:cart-rendered"), false, "Internal event names are outside the public-copy rule.");
  assert.equal(findPublicAbbreviation("TRG-AB12-34CD"), false, "Order-reference tokens are identifiers, not business names.");

  const builder = await import(pathToFileURL(path.join(ROOT, "scripts", "build-pages-output.mjs")));
  const htmlFiles = builder.publicRootFiles
    .filter((item) => item.toLowerCase().endsWith(".html"))
    .map((item) => path.join(ROOT, item));
  const publicHtmlDirectories = builder.publicDirectories.filter((item) => !["owner", "office", "assets", "data", "shared"].includes(item));
  for (const directory of publicHtmlDirectories) {
    htmlFiles.push(...walk(path.join(ROOT, directory)).filter((item) => item.toLowerCase().endsWith(".html")));
  }
  for (const file of htmlFiles.filter((item) => item.toLowerCase().endsWith(".html"))) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    for (const copy of publicHtmlCopy(fs.readFileSync(file, "utf8"))) assertPublicCopy(copy, relative);
  }

  const clientScripts = walk(path.join(ROOT, "assets", "js"))
    .filter((item) => /\.(?:js|mjs)$/.test(item));
  for (const file of clientScripts) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (/(?:^|\/)owner[-/]/i.test(relative)) continue;
    for (const copy of publicScriptStrings(fs.readFileSync(file, "utf8"))) assertPublicCopy(copy, relative);
  }

  const dataDirectory = path.join(ROOT, "data");
  const publicData = fs.readdirSync(dataDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dataDirectory, entry.name));
  for (const file of publicData) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    for (const copy of jsonStrings(JSON.parse(fs.readFileSync(file, "utf8")))) assertPublicCopy(copy, relative);
  }

  console.log("Public-facing Tobacco Road Games branding checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
