const assert = require("node:assert/strict");
const path = require("node:path");
const { normalizeManifest, parseArguments } = require("./import-admin-publications-staging.js");

const manifestPath = path.join(__dirname, "fixture-manifest.json");
const fixture = {
  schemaVersion: 1,
  operatorUserId: "staging-admin-open-rules",
  products: [{
    pdfPath: "test-admin-publication-import.js",
    slug: "open-rules-fixture",
    title: "Open Rules Fixture",
    authors: ["RV Sawyer"],
    pageCount: 12,
    productLine: "5e Reference Library",
    shortDescription: "A test-only manifest entry.",
    longDescription: "A test-only manifest entry used to protect staging assisted-import validation.",
    features: ["Existing Intake validation"]
  }]
};

const normalized = normalizeManifest(fixture, manifestPath);
assert.equal(normalized.operatorUserId, "staging-admin-open-rules");
assert.equal(normalized.products.length, 1);
assert.equal(normalized.products[0].version, "1.0");
assert.equal(normalized.products[0].language, "English");
assert.equal(normalized.products[0].pdfPath, __filename);

assert.deepEqual(parseArguments([manifestPath]), { manifestPath, verifyOnly: false, resume: false, onlySlugs: [] });
assert.deepEqual(parseArguments([manifestPath, "--resume"]), { manifestPath, verifyOnly: false, resume: true, onlySlugs: [] });
assert.deepEqual(parseArguments(["--verify-only", manifestPath, "--only=open-rules-fixture,second-fixture"]), {
  manifestPath,
  verifyOnly: true,
  resume: false,
  onlySlugs: ["open-rules-fixture", "second-fixture"]
});

assert.throws(() => normalizeManifest({ ...fixture, products: [fixture.products[0], fixture.products[0]] }, manifestPath),
  /Duplicate manifest slug/);
assert.throws(() => normalizeManifest({ ...fixture, products: [{ ...fixture.products[0], pageCount: 1 }] }, manifestPath),
  /multi-page PDF/);
assert.throws(() => normalizeManifest({ ...fixture, products: [{ ...fixture.products[0], slug: "Unsafe Slug" }] }, manifestPath),
  /URL-safe slug/);

console.log("Admin publication assisted-import manifest regression checks passed.");
