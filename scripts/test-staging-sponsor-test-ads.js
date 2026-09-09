const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("ops/staging/sponsor-test-ads.sql");
const loader = read("ops/staging/load-sponsor-test-ads.ps1");
const assets = [
  "assets/images/sponsor/staging-tobacco-road-games-books.svg",
  "assets/images/sponsor/staging-tobacco-road-games-open-shelves.svg",
];

assert.equal((sql.match(/'staging-test-tobacco-road-games-ad-[12]'/g) || []).length, 2);
assert.equal((sql.match(/'event'/g) || []).length, 2);
assert.equal((sql.match(/'active', 'approved'/g) || []).length, 2);
assert.equal((sql.match(/'\/store\/'/g) || []).length, 2);
assert.match(loader, /trg-orders-staging --remote/);
assert.match(loader, /tobacco-road-games-staging/);
assert.match(loader, /database_name\\s\*=\\s\*"trg-orders-staging"/);

for (const asset of assets) {
  const svg = read(asset);
  assert.match(svg, /width="1040" height="124" viewBox="0 0 1040 124"/);
  assert.match(svg, />Tobacco Road Games<\/text>/);
  assert.doesNotMatch(svg, />TRG</);
  assert.ok(sql.includes(`'/${asset}'`));
}

assert.match(read(assets[0]), /Books Worth Pulling From the Shelf/);
assert.match(read(assets[1]), /Independent Games\. Open Shelves\./);
console.log("Staging sponsor test-ad fixture tests passed.");
