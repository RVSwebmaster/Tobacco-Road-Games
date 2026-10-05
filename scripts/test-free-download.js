const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "free-download-test-secret-at-least-32-characters";
const PDF = new TextEncoder().encode("%PDF-1.7\nFree download test\n%%EOF\n");

async function main() {
  const { getDeliveryProduct } = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-delivery.mjs")).href);
  const free = await importModule("functions/_lib/free-download.mjs");
  assert.equal(fs.existsSync(path.join(ROOT, "store/products/agency/index.html")), false, "The cleared launch catalog must not retain the old Agency page.");
  assert.equal(fs.existsSync(path.join(ROOT, "store/products/janni/index.html")), false, "The cleared launch catalog must not retain the old Janni page.");
  assert.equal(getDeliveryProduct("janni"), null, "The cleared launch catalog must not retain old exact delivery mappings.");

  let stripeCalls = 0;
  const bucket = createBucket();
  const openEnv = { DOWNLOAD_SIGNING_SECRET: SECRET, STRIPE_SECRET_KEY: { get value() { stripeCalls += 1; return ""; } }, TRG_ORDERS: stateDatabase("OPEN"), TRG_PRODUCTS: bucket };
  const issued = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), openEnv, { nowMs: 1000000, allowLegacyAnonymousAcquisition: true });
  assert.equal(issued.status, 404, "OPEN should not issue a private redirect for removed launch catalog products.");
  assert.equal(stripeCalls, 0, "Free fulfillment must never inspect or call Stripe.");
  let response = await free.handleFreeDownloadFileRequest(new Request("https://example.com/store/free-download-file"), openEnv, { nowMs: 1001000 });
  assert.equal(response.status, 403, "Private R2 content must require a valid credential.");

  for (const state of ["CLOSED", "MAINTENANCE"]) {
    const env = { ...openEnv, TRG_ORDERS: stateDatabase(state) };
    response = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), env, { nowMs: 1000000 });
    assert.equal(response.status, 503, `${state} must block acquisition before catalog eligibility is considered.`);
  }

  response = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), { ...openEnv, TRG_ORDERS: failingDatabase() });
  assert.equal(response.status, 503, "Unreadable state must fail closed for free downloads.");
  assert.equal(bucket.getCalls, 0, "Rejected legacy acquisition must not read private R2 bytes.");
  console.log("Free product download tests passed.");
}

function stateDatabase(state) { return { prepare() { return { bind() { return this; }, async first() { return { setting_value: state, updated_at: "now", updated_by: "test" }; } }; } }; }
function failingDatabase() { return { prepare() { throw new Error("unavailable"); } }; }
function createBucket() { return { getCalls: 0, async head(key) { return key === "removed/product.pdf" ? { size: PDF.length } : null; }, async get(key) { this.getCalls += 1; return key === "removed/product.pdf" ? { body: PDF, size: PDF.length } : null; } }; }
function importModule(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?test=${Date.now()}`); }

main().catch(error => { console.error(error); process.exitCode = 1; });
