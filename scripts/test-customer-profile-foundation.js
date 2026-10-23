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
  assert.doesNotMatch(foundation, new RegExp(asset.replace(".", "\\.")));
}

assert.match(foundation, /shop-wall-fixed-cabinet/);
assert.match(foundation, /shop-wall-bay shop-wall-bay--identity/);
assert.match(foundation, /customer-profile-cabinet-clean\.png/);
assert.doesNotMatch(foundation, /golden-d20-lantern-logo\.png/);
assert.ok(fs.existsSync(path.join(root, "assets/images/customer-profile/customer-profile-cabinet-clean.png")));
assert.equal((foundation.match(/data-profile-shelf="(?:upper|lower)-(?:left|right)"/g) || []).length, 4);
for (const position of ["upper-left", "lower-left", "upper-right", "lower-right"]) {
  assert.match(foundation, new RegExp(`data-profile-shelf="${position}"`));
}

assert.doesNotMatch(foundation, /fetch\s*\(|XMLHttpRequest|\/api\/|localStorage|sessionStorage/);
assert.doesNotMatch(foundation, /owner-profile__tabs|profile-poster|data-profile-tab|admin|financial/i);
assert.match(styles, /\.customer-profile-foundation > \.shop-wall-fixed-cabinet/);
assert.match(styles, /\.customer-profile-foundation \{[\s\S]*?min-height: calc\(200vh - 66px\);/);
assert.match(styles, /\.customer-profile-cabinet \{[\s\S]*?--cabinet-width: 1144;[\s\S]*?--cabinet-height: 454;/);
assert.match(styles, /\.shop-wall-fixed-cabinet\.customer-profile-cabinet \[data-profile-shelf\] \{[\s\S]*?position: absolute;[\s\S]*?display: block;[\s\S]*?overflow: hidden;/);
assert.match(styles, /\.shop-wall-fixed-cabinet\.customer-profile-cabinet \[data-profile-shelf\] > \.shop-wall-product-row--library \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?width: auto;[\s\S]*?height: auto;/);
assert.match(styles, /\.shop-wall-fixed-cabinet\.customer-profile-cabinet \.shop-wall-library-books,[\s\S]*?top: auto;[\s\S]*?bottom: 0;[\s\S]*?left: calc\(var\(--library-bookstop-clearance, 0px\) \/ 2\);[\s\S]*?right: calc\(var\(--library-bookstop-clearance, 0px\) \/ 2\);[\s\S]*?height: 100%;[\s\S]*?max-height: 100%;/);

const expectedShelfGeometry = {
  "upper-left": { top: 53, left: 16, width: 360, height: 141 },
  "lower-left": { top: 203, left: 16, width: 360, height: 139 },
  "upper-right": { top: 53, left: 750, width: 373, height: 141 },
  "lower-right": { top: 203, left: 750, width: 373, height: 139 },
};
const shelfSurfacesByPageHeight = [720, 1440].map(() => Object.fromEntries(
  Object.entries(expectedShelfGeometry).map(([position, geometry]) => [position, geometry.top + geometry.height]),
));
assert.deepEqual(shelfSurfacesByPageHeight[0], shelfSurfacesByPageHeight[1], "doubling page height must not move shelf surfaces");
for (const [position, geometry] of Object.entries(expectedShelfGeometry)) {
  const rule = styles.match(new RegExp(`\\[data-profile-shelf="${position}"\\] \\{([\\s\\S]*?)\\}`));
  assert.ok(rule, `${position} must have a stable shelf container`);
  assert.doesNotMatch(rule[1], /(?:v[hw]|%|calc\()/, `${position} must not depend on viewport or page dimensions`);
  for (const [property, value] of Object.entries(geometry)) {
    assert.match(rule[1], new RegExp(`${property}: ${value}px;`));
  }
}
assert.match(styles, /@media \(max-width: 699px\)[\s\S]*?\.customer-profile-foundation > \.shop-wall-fixed-cabinet/);
assert.ok(!routes.include.some((route) => route === "/preview/*" || route.startsWith("/preview/")), "preview must remain outside Functions/Access routing");

console.log("Customer Profile foundation test passed.");
