const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const previewPath = path.join(root, "preview", "owner-profile.html");
const html = fs.readFileSync(previewPath, "utf8");
const routes = JSON.parse(fs.readFileSync(path.join(root, "_routes.json"), "utf8"));
const build = fs.readFileSync(path.join(root, "scripts", "build-pages-output.mjs"), "utf8");

assert.match(html, /Read-only staging preview/i);
assert.match(html, /Private data and working controls are intentionally unavailable/i);
assert.match(html, /Owner controls omitted/i);
assert.match(html, /noindex, nofollow/i);
assert.doesNotMatch(html, /<script\b/i, "Preview must not execute Owner Profile JavaScript.");
assert.doesNotMatch(html, /<form\b/i, "Preview must not contain working forms.");
assert.doesNotMatch(html, /<button\b/i, "Preview must not contain working buttons.");
assert.doesNotMatch(html, /\/owner\//i, "Preview must not link into protected Owner routes.");
assert.doesNotMatch(html, /owner\/api|api\/profile/i, "Preview must not load private Owner APIs.");
assert.equal(routes.include.some((route) => route.startsWith("/preview")), false, "Static preview must remain outside the Functions and Owner middleware routes.");
assert.match(build, /"preview"/, "The allowlisted Pages build must publish the preview directory.");

console.log("Sanitized Owner Profile preview tests passed.");
