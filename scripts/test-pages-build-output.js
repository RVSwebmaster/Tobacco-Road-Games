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
    const preservedCreator = fs.readFileSync(path.join(outputDirectory, "temp-creator", "index.html"), "utf8");
    assert.match(preservedCreator, /creator-dashboard\.js\?v=/, "Preserved Creator dashboard runtime is missing");
    assert.match(preservedCreator, /id="creator-pdf-intake"/, "Preserved Creator PDF Intake is missing");
    const blankCreator = fs.readFileSync(path.join(outputDirectory, "creator", "index.html"), "utf8");
    assert.match(blankCreator, /<h1[^>]*>Creator Dashboard<\/h1>/, "Blank Creator Dashboard title is missing");
    assert.match(blankCreator, /href="\/temp-creator\/"/, "Blank Creator Dashboard fallback link is missing");
    assert.doesNotMatch(blankCreator, /id="creator-pdf-intake"/, "Blank Creator Dashboard must not contain PDF Intake");
    for (const relativePath of builder.excludedPublicFiles) {
      assert.equal(fs.existsSync(path.join(outputDirectory, relativePath)), false, `excluded file was copied: ${relativePath}`);
    }
    for (const relativePath of ["tmp", "videos", "node_modules", ".git", "docs", "scripts", "functions"]) {
      assert.equal(fs.existsSync(path.join(outputDirectory, relativePath)), false, `non-public path was copied: ${relativePath}`);
    }
    const generatedGuest = fs.readFileSync(path.join(outputDirectory, "guest", "index.html"), "utf8");
    const generatedCustomer = fs.readFileSync(path.join(outputDirectory, "customer.html"), "utf8");
    assert.match(generatedCustomer, /data-customer-storefront/);
    assert.match(generatedCustomer, /data-progressive-navigation/);
    const openRulesSection = (page) => page.match(/<section class="shop-wall-bay shop-wall-bay--products guest-open-rules-bay"[\s\S]*?<\/section>/)?.[0] || "";
    assert.equal(openRulesSection(generatedCustomer), openRulesSection(generatedGuest), "Customer Open Rules shelf must remain identical to the Guest shelf.");
    const lowerMerchandising = (page) => {
      const start = page.indexOf('<section class="shop-wall-row shop-wall-row--merchandising"');
      const end = page.indexOf("</main>", start);
      return start >= 0 && end >= 0 ? page.slice(start, end) : "";
    };
    assert.equal(lowerMerchandising(generatedCustomer), lowerMerchandising(generatedGuest), "Customer lower merchandising must remain untouched.");
    assert.match(generatedGuest, /magical-bookshelf\.js\?v=20261116-open-rules-master-shelf2/);
    assert.match(generatedGuest, /guest-landing\.css\?v=20261116-guest-examination-close1/);
    assert.match(generatedGuest, /homepage-shelves\.js\?v=20261116-open-rules-master-shelf4/);
    assert.match(generatedGuest, /guest-product-preview\.js\?v=20261116-guest-book-examination7/);
    assert.doesNotMatch(generatedGuest, /data-magical-bookshelf-replay/);
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "guest-product-preview.js")), "Guest preview runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "homepage-shelves.js")), "Homepage shelf runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "owner", "product-intake.html")), "Owner Product Intake page is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "product-pdf-autofill.mjs")), "Product PDF autofill runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "js", "product-pdf-images.mjs")), "Product PDF image extraction runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "vendor", "pdfjs", "pdf.mjs")), "Pinned PDF.js browser runtime is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "assets", "vendor", "pdfjs", "pdf.worker.mjs")), "Pinned PDF.js worker is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "shared", "product-pdf-prefill.mjs")), "Shared PDF inference helper is missing from Pages output");
    assert.ok(fs.existsSync(path.join(outputDirectory, "shared", "product-pdf-image-utils.mjs")), "Shared PDF image sizing helper is missing from Pages output");
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
