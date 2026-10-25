const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const guest = read("guest/index.html");
const builder = read("scripts/build-store.js");
const animation = read("assets/js/magical-bookshelf.js");
const baseline = read("docs/GUEST-BOOKSHELF-BASELINE.md");

assert.match(guest, /data-guest-landing/);
assert.match(guest, /data-magical-bookshelf-demo/);
assert.match(guest, /data-magical-bookshelf-replay hidden/);
assert.equal((guest.match(/data-magical-bookshelf(?:\s|>)/g) || []).length, 7, "Guest must retain all seven animated shelf containers.");
assert.equal((guest.match(/data-magical-book(?:\s|>)/g) || []).length, 36, "Open Rules must retain all 36 decorative book positions.");
assert.equal((guest.match(/data-magical-shelf-order="[1-7]"/g) || []).length, 7, "Every animated shelf must have an explicit sequence order.");
assert.equal((guest.match(/data-magical-direction="outer-inward"/g) || []).length, 3, "Outer-inward product shelves must retain their direction contract.");
assert.match(guest, /data-magical-direction="right-to-left"/);
assert.match(guest, /data-magical-direction="left-to-right"/);

assert.match(animation, /DEFAULT_INTERVAL_MS = 500/);
assert.match(animation, /createFlashDescriptors/);
assert.match(animation, /1 \+ Math\.floor\(random\(\) \* 3\)/);
assert.match(animation, /buildEffectAnchors/);
assert.match(animation, /event\.code !== "Space"/);
assert.match(animation, /prefers-reduced-motion/);
assert.match(builder, /renderGuestOpenRulesBay/);
assert.match(builder, /renderHomepageProductBay\(\{ title: "FEATURED CREATOR"/);
assert.match(builder, /renderHomepageProductBay\(\{ title: "NEW THIS WEEK"/);
assert.match(builder, /renderHomepageProductBay\(\{ title: "BEST SELLERS"/);

for (const phrase of ["approved shared visual foundation", "Mouse-over behavior", "preview overlays", "full-product navigation"]) {
  assert.match(baseline, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
}

console.log("Guest bookshelf approved baseline tests passed.");
