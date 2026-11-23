const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const accountHtml = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
  const accountRuntime = fs.readFileSync(path.join(ROOT, "assets", "js", "account.js"), "utf8");
  const generator = require(path.join(ROOT, "scripts", "build-store.js"));
  const backRoom = generator.renderStorefrontBackRoom();

  assert.doesNotMatch(accountHtml, /forum-profile-panel|forum-profile-form|href="\/forum"|forum-avatar/i);
  assert.doesNotMatch(accountRuntime, /\/api\/forum|forum-profile|forum-avatar|forumHandle/i);
  assert.doesNotMatch(backRoom, /href="\/forum"|Community|discussion/i);
  assert.match(backRoom, /Creator and support resources/);
  assert.ok(fs.existsSync(path.join(ROOT, "functions", "forum", "index.js")), "Forum backend remains preserved as deferred infrastructure.");
  assert.ok(fs.existsSync(path.join(ROOT, "functions", "api", "forum", "profile", "[[handle]].js")), "Forum API implementation remains preserved.");
  console.log("Customer Account Forum surface tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
