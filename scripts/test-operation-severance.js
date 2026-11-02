const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

async function main() {
  const root = path.resolve(__dirname, "..");
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const homepage = await load("functions/_lib/owner-homepage-publish.mjs");
  const pricing = await load("functions/_lib/owner-pricing-publish.mjs");
  const creator = await load("functions/_lib/creator-publication.mjs");

  const forbidden = () => { throw new Error("Publication attempted an external write."); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = forbidden;
  try {
    const homepageResponse = await homepage.handleOwnerHomepagePublishRequest(
      request({ featuredSlug: "fixture-alpha", workInProgressSlugs: ["fixture-beta"] }),
      { TRG_PRODUCTS: { put: forbidden } }
    );
    assert.equal(homepageResponse.status, 503);
    const homepageBody = await homepageResponse.json();
    assert.equal(homepageBody.code, "bindings_unavailable");
    assert.notEqual(homepageBody.ok, true);

    const pricingResponse = await pricing.handleOwnerPricingPublishRequest(
      request({ slug: "fixture-alpha", currency: "USD", price: "5.00", priceCents: 500 }),
      {}
    );
    assert.equal(pricingResponse.status, 503);
    const pricingBody = await pricingResponse.json();
    assert.equal(pricingBody.code, "bindings_unavailable");
    assert.notEqual(pricingBody.ok, true);

    const paused = await creator.pauseListingPublication({ listing: { id: "listing", public_product_slug: "fixture-alpha" } });
    await assertUnavailable(paused);

    let writes = 0;
    const db = {
      prepare(sql) {
        if (!sql.startsWith("SELECT")) { writes += 1; throw new Error("Publication attempted a D1 write."); }
        return {
          bind() { return this; },
          async first() { return { id: "bundle", creator_id: "creator", publication_state: "approved" }; },
          async all() { return { results: [
            { creator_id: "creator", publication_state: "published", public_product_slug: "one", owner_review_hold: 0 },
            { creator_id: "creator", publication_state: "published", public_product_slug: "two", owner_review_hold: 0 }
          ] }; }
        };
      }
    };
    const bundle = await creator.handleCreatorPublicationRequest(request({ action: "publish_bundle", bundleId: "bundle" }), {}, { database: db });
    assert.equal(bundle.status, 401);
    assert.equal((await bundle.json()).code, "authentication_required");
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const runtime = path.join(root, "functions");
  const files = walk(runtime).filter(file => /\.(mjs|js)$/.test(file));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /dispatchPublishWorkflow|api\.github\.com|GITHUB_(?:TOKEN|REPO_OWNER|REPO_NAME|PUBLISH_REF|PUBLISH_WORKFLOW_FILE)/, file);
  }
  assert.equal(fs.existsSync(path.join(root, "functions/_lib/github-dispatch.mjs")), false);
  assert.equal(fs.existsSync(path.join(root, ".github/workflows/publish-owner-intake.yml")), false);
  const retiredCommand = spawnSync(process.execPath, [path.join(root, "scripts/publish-intake.js")], { encoding: "utf8" });
  assert.equal(retiredCommand.status, 1);
  assert.match(retiredCommand.stderr, /repository publishing command is retired/i);
  const retiredSyncWrite = spawnSync(process.execPath, [path.join(root, "scripts/sync-r2-products.js"), "--build"], { encoding: "utf8" });
  assert.equal(retiredSyncWrite.status, 1);
  assert.match(retiredSyncWrite.stderr, /repository catalog publication is retired/i);
  console.log("Operation Severance tests passed.");
}

function request(body) {
  return new Request("https://example.com/owner/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function assertUnavailable(response) {
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /publication is temporarily unavailable/i);
  assert.notEqual(body.ok, true);
  assert.equal(body.pending, undefined);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
