const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(repositoryRoot, ".wrangler", "test-pages-output");

async function main() {
  const builder = await import(pathToFileURL(path.join(__dirname, "build-pages-output.mjs")));
  try {
    const result = builder.buildPagesOutput(outputDirectory);
    assert.equal(result.outputDirectory, outputDirectory);
    assert.ok(result.fileCount > 0);
    assert.match(fs.readFileSync(path.join(outputDirectory, "_redirects"), "utf8"), /^\/ \/guest\/ 200\s*$/m, "Pages output must preserve the Guest homepage rewrite.");

    for (const relativePath of builder.publicRootFiles) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing root file: ${relativePath}`);
    }
    for (const relativePath of builder.publicDirectories) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing public directory: ${relativePath}`);
    }
    for (const relativePath of builder.excludedPublicFiles) {
      assert.equal(fs.existsSync(path.join(outputDirectory, relativePath)), false, `excluded file was copied: ${relativePath}`);
    }
    for (const relativePath of ["tmp", "videos", "node_modules", ".git", "docs", "scripts", "functions"]) {
      assert.equal(fs.existsSync(path.join(outputDirectory, relativePath)), false, `non-public path was copied: ${relativePath}`);
    }
    const generatedGuest = fs.readFileSync(path.join(outputDirectory, "guest", "index.html"), "utf8");
    assert.match(generatedGuest, /magical-bookshelf\.js\?v=20261026-homepage-shelves1/);
    assert.match(generatedGuest, /guest-landing\.css\?v=20261026-homepage-shelves1/);
    assert.match(generatedGuest, /guest-product-preview\.js\?v=20261026-homepage-shelves1/);
    assert.doesNotMatch(generatedGuest, /data-magical-bookshelf-replay/);
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "guest-product-preview.js")), "Guest preview runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "homepage-shelves.js")), "Homepage shelf runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "data", "guest-preview-products.json")), "Guest preview fixture data is missing from Pages output");
    assert.ok(fs.existsSync(path.join(repositoryRoot, "functions")), "Pages Functions source is missing");
    assert.throws(
      () => builder.buildPagesOutput(path.join(repositoryRoot, "unsafe-output")),
      /dedicated \*pages-output directory/,
    );
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
  console.log("Pages build output allowlist test passed.");
}

main().catch((error) => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
