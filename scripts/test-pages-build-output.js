const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(repositoryRoot, ".wrangler", "test-pages-output");

async function main() {
  const builder = await import(pathToFileURL(path.join(__dirname, "build-pages-output.mjs")));
  const pipeline = await import(pathToFileURL(path.join(__dirname, "release-pipeline.mjs")));
  try {
    const result = builder.buildPagesOutput(outputDirectory);
    assert.equal(result.outputDirectory, outputDirectory);
    assert.ok(result.fileCount > 0);
    assert.equal(result.sourceOutputSha256, pipeline.hashDirectory(outputDirectory), "Build source fingerprint must use the release pipeline's canonical file hashing.");
    assert.match(fs.readFileSync(path.join(outputDirectory, "_redirects"), "utf8"), /^\/ \/guest\/ 200\s*$/m, "Pages output must preserve the Guest homepage rewrite.");
    const routes = JSON.parse(fs.readFileSync(path.join(outputDirectory, "_routes.json"), "utf8"));
    assert.ok(routes.include.includes("/api/creator-plateboard"), "Pages Functions must route the free Creator plateboard feed.");

    for (const relativePath of builder.publicRootFiles) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing root file: ${relativePath}`);
    }
    for (const relativePath of builder.publicDirectories) {
      assert.ok(fs.existsSync(path.join(outputDirectory, relativePath)), `missing public directory: ${relativePath}`);
    }
    const redirects = fs.readFileSync(path.join(outputDirectory, "_redirects"), "utf8");
    assert.match(redirects, /^\/temp-creator\/ \/creator-dashboard\/ 301\s*$/m, "The former temporary Creator route must resolve through the protected legacy alias.");
    assert.doesNotMatch(redirects, /^\/creator-dashboard\/ \/temp-creator\//m, "The legacy Creator route must not redirect back to the temporary URL.");
    assert.equal(builder.publicDirectories.includes("temp-creator"), false, "The retired temporary Dashboard directory must not be published.");
    assert.equal(builder.publicDirectories.includes("creator-dashboard"), false, "The retired standalone Creator Dashboard must not be published.");
    const creatorTools = fs.readFileSync(path.join(outputDirectory, "creator-tools", "index.html"), "utf8");
    assert.match(creatorTools, /creator-dashboard\.js\?v=/, "Existing Creator tools runtime is missing from its preserved route.");
    assert.match(creatorTools, /id="creator-pdf-intake"/, "Existing Creator tools remain available.");
    assert.match(creatorTools, /creator-dashboard-shop-wall/, "Creator tools retain their approved furniture.");
    assert.match(creatorTools, /upper-cabinet-creator-desktop\.png/, "Creator tools use their approved responsive cabinet artwork.");
    assert.doesNotMatch(creatorTools, /creator-connect-dashboard|Open Stripe Express Dashboard/, "Shelved Stripe Express Dashboard UI must not be activated by route reconciliation.");
    const creatorProfile = fs.readFileSync(path.join(outputDirectory, "creator", "index.html"), "utf8");
    assert.match(creatorProfile, /<title>Member Profile \| Tobacco Road Games<\/title>/, "The /creator/ route must be the shared Creator Profile.");
    assert.match(creatorProfile, /data-member-profile-page/);
    assert.match(creatorProfile, /data-member-dashboard-link/, "Creator Profile links into the shared Dashboard.");
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
    const dashboard = fs.readFileSync(path.join(outputDirectory, "dashboard", "index.html"), "utf8");
    assert.match(dashboard, /data-customer-membership/, "Pages output includes the single shared Common Membership workspace.");
    assert.match(dashboard, /data-dashboard-tabs/, "Pages output includes the shared tier tab architecture.");
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

    const commitSha = "1b1a8a78e5cf24885b2ab24e3a30b7aacefb18a6";
    builder.buildPagesOutput(outputDirectory, { commitSha, branch: "main" });
    const marker = JSON.parse(fs.readFileSync(path.join(outputDirectory, "trg-release.json"), "utf8"));
    assert.equal(marker.commitSha, commitSha, "Cloudflare build marker must expose the exact full source SHA.");
    assert.equal(marker.branch, "main", "Cloudflare build marker must expose its source branch.");
    assert.equal(marker.buildProvider, "cloudflare-pages", "Automatic Pages builds must be distinguishable from release artifacts.");
    assert.equal(marker.sourceOutputSha256, result.sourceOutputSha256, "Cloudflare marker must fingerprint the same static source files as the release pipeline.");
    assert.equal(builder.hashPagesSourceOutput(outputDirectory), result.sourceOutputSha256, "The release marker itself must not alter the source output fingerprint.");
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
