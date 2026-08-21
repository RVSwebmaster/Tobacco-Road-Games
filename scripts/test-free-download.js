const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "free-download-test-secret-at-least-32-characters";
const PDF = new TextEncoder().encode("%PDF-1.7\nAgency free test\n%%EOF\n");

async function main() {
  const { getDeliveryProduct } = await import(pathToFileURL(path.join(ROOT, "functions/_lib/product-delivery.mjs")).href);
  const free = await importModule("functions/_lib/free-download.mjs");
  const agencyPage = fs.readFileSync(path.join(ROOT, "store/products/agency/index.html"), "utf8");
  const janniPage = fs.readFileSync(path.join(ROOT, "store/products/janni/index.html"), "utf8");
  assert.match(agencyPage, /Download Free PDF/, "$0.00 products should display the free-download control.");
  assert.doesNotMatch(agencyPage, /data-cart-add="agency"/, "Free products must not display Add to Cart.");
  assert.match(janniPage, /data-cart-add="janni"/, "Paid products must retain the existing cart control.");
  assert.deepEqual(getDeliveryProduct("janni"), {
    contentType: "application/pdf",
    customerFilename: "Janni.pdf",
    productSlug: "janni",
    r2ObjectKey: "janni/product.pdf"
  }, "Janni must have an exact private paid-delivery mapping.");

  let stripeCalls = 0;
  const bucket = createBucket();
  const openEnv = { DOWNLOAD_SIGNING_SECRET: SECRET, STRIPE_SECRET_KEY: { get value() { stripeCalls += 1; return ""; } }, TRG_ORDERS: stateDatabase("OPEN"), TRG_PRODUCTS: bucket };
  const issued = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), openEnv, { nowMs: 1000000 });
  assert.equal(issued.status, 303, "OPEN should issue a short-lived free-download redirect.");
  assert.equal(stripeCalls, 0, "Free fulfillment must never inspect or call Stripe.");
  const location = issued.headers.get("location");
  assert.match(location, /free-download-file\?credential=/, "Issuance should redirect through an authorized private route.");

  let response = await free.handleFreeDownloadFileRequest(new Request(location), openEnv, { nowMs: 1001000 });
  assert.equal(response.status, 200, "OPEN should allow an authorized free download.");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /Agency\.pdf/);
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), Buffer.from(PDF).toString("utf8"));

  response = await free.handleFreeDownloadFileRequest(new Request("https://example.com/store/free-download-file"), openEnv, { nowMs: 1001000 });
  assert.equal(response.status, 403, "Private R2 content must require a valid credential.");

  for (const state of ["CLOSED", "MAINTENANCE"]) {
    const env = { ...openEnv, TRG_ORDERS: stateDatabase(state) };
    response = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), env, { nowMs: 1000000 });
    assert.equal(response.status, 503, `${state} must block free credential issuance.`);
    response = await free.handleFreeDownloadFileRequest(new Request(location), env, { nowMs: 1001000 });
    assert.equal(response.status, 503, `${state} must block credential redemption.`);
  }

  response = await free.handleFreeDownloadRequest(new Request("https://example.com/store/free-download?product=agency"), { ...openEnv, TRG_ORDERS: failingDatabase() });
  assert.equal(response.status, 503, "Unreadable state must fail closed for free downloads.");
  assert.equal(bucket.getCalls, 1, "Only the authorized OPEN redemption should read private R2 bytes.");
  console.log("Free product download tests passed.");
}

function stateDatabase(state) { return { prepare() { return { bind() { return this; }, async first() { return { setting_value: state, updated_at: "now", updated_by: "test" }; } }; } }; }
function failingDatabase() { return { prepare() { throw new Error("unavailable"); } }; }
function createBucket() { return { getCalls: 0, async head(key) { return key === "agency/product.pdf" ? { size: PDF.length } : null; }, async get(key) { this.getCalls += 1; return key === "agency/product.pdf" ? { body: PDF, size: PDF.length } : null; } }; }
function importModule(relativePath) { return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?test=${Date.now()}`); }

main().catch(error => { console.error(error); process.exitCode = 1; });
