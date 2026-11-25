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
    const routes = JSON.parse(fs.readFileSync(path.join(outputDirectory, "_routes.json"), "utf8"));
    assert.ok(routes.include.includes("/api/creator-plateboard"), "Pages Functions must route the free Creator plateboard feed.");

    for (const relativePath of builder.publicRootFiles) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing root file: ${relativePath}`);
    }
    for (const relativePath of builder.publicDirectories) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing public directory: ${relativePath}`);
    }
    const creatorDashboard = fs.readFileSync(path.join(outputDirectory, "temp-creator", "index.html"), "utf8");
    assert.match(creatorDashboard, /creator-dashboard\.js\?v=/, "Creator Dashboard runtime is missing from its actual route.");
    assert.match(creatorDashboard, /id="creator-pdf-intake"/, "Creator PDF Intake is missing from the Dashboard.");
    const creatorProfile = fs.readFileSync(path.join(outputDirectory, "creator", "index.html"), "utf8");
    assert.match(creatorProfile, /<title>Member Profile \| Tobacco Road Games<\/title>/, "The /creator/ route must be the shared Creator Profile.");
    assert.match(creatorProfile, /data-member-profile-page/);
    assert.doesNotMatch(creatorProfile, /id="creator-pdf-intake"/, "Creator publishing controls belong on the Dashboard, not the Profile.");
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
    assert.match(generatedCustomer, /data-homepage-library/);
    assert.doesNotMatch(generatedCustomer, /href="\/account\.html">Login\/Signup/);
    const section = (page, pattern) => page.match(pattern)?.[0] || "";
    const openRulesPattern = /<section class="shop-wall-bay shop-wall-bay--products guest-open-rules-bay"[\s\S]*?<\/section>/;
    assert.equal(section(generatedCustomer, openRulesPattern), section(generatedGuest, openRulesPattern),
      "The Customer Open Rules shelf remains shared with Guest.");
    const merchandising = (page) => {
      const start = page.indexOf('<section class="shop-wall-row shop-wall-row--merchandising"');
      const end = page.indexOf("</main>", start);
      return start >= 0 && end >= 0 ? page.slice(start, end) : "";
    };
    assert.equal(merchandising(generatedCustomer), merchandising(generatedGuest),
      "Customer-specific navigation and library hooks must not alter lower merchandising.");
    assert.match(generatedGuest, /magical-bookshelf\.js\?v=20261116-open-rules-master-shelf2/);
    assert.match(generatedGuest, /guest-landing\.css\?v=20261116-guest-examination-close1/);
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
