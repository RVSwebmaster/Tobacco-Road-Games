const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const preview = read("preview/customer-profile.html");
const foundation = read("assets/js/customer-profile-foundation.js");
const homepage = read("index.html");
const styles = read("styles.css");
const routes = JSON.parse(read("_routes.json"));

assert.match(preview, /<header class="site-header">/);
assert.match(preview, /<nav class="site-nav" aria-label="Primary">/);
assert.match(preview, /data-customer-profile-foundation/);
assert.match(preview, /meta name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(preview, /owner-profile__tabs|poster|dashboard|admin|financial/i);
for (const href of ["/store/catalog/", "/forum", "/authors.html", "/creator/", "/support.html", "/account.html", "/store/cart/"]) {
  assert.match(homepage, new RegExp(`href="${href.replaceAll("/", "\\/")}`));
  assert.match(preview, new RegExp(`href="${href.replaceAll("/", "\\/")}`));
}

for (const asset of ["upper-cabinet-desktop.png", "upper-cabinet-tablet.png", "upper-cabinet-mobile.png"]) {
  assert.match(homepage, new RegExp(asset.replace(".", "\\.")));
  assert.match(foundation, new RegExp(asset.replace(".", "\\.")));
}

assert.match(foundation, /shop-wall-fixed-cabinet/);
assert.match(foundation, /shop-wall-bay shop-wall-bay--identity/);
assert.match(foundation, /golden-d20-lantern-logo\.png/);
assert.equal((foundation.match(/data-profile-shelf="(?:upper|lower)-(?:left|right)"/g) || []).length, 4);
for (const position of ["upper-left", "lower-left", "upper-right", "lower-right"]) {
  assert.match(foundation, new RegExp(`data-profile-shelf="${position}"`));
}

assert.doesNotMatch(foundation, /fetch\s*\(|XMLHttpRequest|\/api\/|localStorage|sessionStorage/);
assert.doesNotMatch(foundation, /owner-profile__tabs|profile-poster|data-profile-tab|admin|financial/i);
assert.match(styles, /\.customer-profile-foundation > \.shop-wall-fixed-cabinet/);
assert.match(styles, /@media \(max-width: 699px\)[\s\S]*?\.customer-profile-foundation > \.shop-wall-fixed-cabinet/);
assert.ok(!routes.include.some((route) => route === "/preview/*" || route.startsWith("/preview/")), "preview must remain outside Functions/Access routing");

console.log("Customer Profile foundation test passed.");
