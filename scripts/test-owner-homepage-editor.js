const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "owner/homepage.html"), "utf8");
const client = fs.readFileSync(path.join(ROOT, "assets/js/owner-homepage-editor.js"), "utf8");

assert.match(html, /id="homepage-shelves"/);
assert.match(html, /id="homepage-revision"/);
assert.match(html, /Homepage Merchandising/);
assert.match(html, /owner-homepage-editor\.js\?v=20261101-task2nb1/);
assert.doesNotMatch(html, /temporarily unavailable/i);
assert.match(client, /const ENDPOINT = "\/owner\/api\/homepage"/);
assert.match(client, /credentials: "same-origin"/);
assert.match(client, /"x-csrf-token": csrfToken/);
assert.match(client, /expectedRevision: revision/);
assert.match(client, /revision_conflict/);
assert.match(client, /Move earlier/);
assert.match(client, /Move later/);
assert.match(client, /ownerHomepageRuntime = "ready"/);
assert.doesNotMatch(client, /\/data\/products\.json|\/data\/homepage\.json|github/i);
assert.match(client, /Cloudflare D1/);
console.log("Owner Homepage Editor wiring tests passed.");
