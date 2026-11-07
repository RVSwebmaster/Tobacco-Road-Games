const assert = require("node:assert/strict");
const { depthForPages } = require("../assets/js/product-book.js");

const cases = [
  [25, 17],
  [100, 24],
  [122, 26],
  [300, 44],
  [500, 60]
];

for (const [pages, expectedDepth] of cases) {
  assert.equal(depthForPages(pages), expectedDepth, `${pages}-page spine depth`);
}
assert.ok(cases.every(([pages], index) => index === 0 || depthForPages(pages) > depthForPages(cases[index - 1][0])));
assert.equal(depthForPages(1), 16, "even a one-page document has a visible book spine");
assert.equal(depthForPages(undefined), 24, "unknown page count uses the 100-page baseline");

console.log("Product book thickness calibration passed.");
