const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const storeState = await importModule("functions/_lib/store-state.mjs");
  const checkout = await importModule("functions/_lib/cart-checkout.mjs");
  const maintenancePages = await importModule("functions/_lib/store-maintenance.mjs");
  const ownerApi = await importModule("functions/_lib/owner-store-status.mjs");

  const open = await storeState.readStoreState({ TRG_ORDERS: stateDatabase("OPEN") });
  assert.equal(open.state, "OPEN", "OPEN should be read as the purchasable runtime state.");
  assert.equal(open.available, true, "A valid OPEN state should be available.");

  for (const state of ["CLOSED", "MAINTENANCE"]) {
    const response = await checkout.handleCartCheckoutRequest(checkoutRequest(), {
      TRG_ORDERS: stateDatabase(state)
    });
    assert.equal(response.status, 503, `${state} must block checkout server-side.`);
    const payload = await response.json();
    assert.equal(payload.storeState, state, `${state} checkout responses should identify the blocking state.`);
  }

  const failed = await storeState.readStoreState({ TRG_ORDERS: failingDatabase() });
  assert.deepEqual({ available: failed.available, state: failed.state }, { available: false, state: "CLOSED" }, "Status read failures must fail closed.");
  const failedCheckout = await checkout.handleCartCheckoutRequest(checkoutRequest(), { TRG_ORDERS: failingDatabase() });
  assert.equal(failedCheckout.status, 503, "Checkout must be refused when status cannot be read.");

  assert.equal(maintenancePages.isPublicStorePage("/store/products/agency/"), true);
  const maintenance = maintenancePages.maintenanceResponse();
  assert.equal(maintenance.status, 503, "Maintenance store pages should return the maintenance display.");
  assert.match(await maintenance.text(), /Store Maintenance/i, "Maintenance should replace the public catalog with a clear display.");

  const unauthorized = await ownerApi.handleOwnerStoreStatusPost(new Request("https://example.com/owner/api/store-status", {
      body: JSON.stringify({ state: "OPEN" }),
      headers: { "content-type": "application/json", origin: "https://example.com" },
      method: "POST"
    }), { TRG_ORDERS: stateDatabase("CLOSED") });
  assert.equal(unauthorized.status, 401, "Unauthenticated users must not alter store status.");

  const generatedCatalog = fs.readFileSync(path.join(ROOT, "store", "catalog", "index.html"), "utf8");
  const statusScript = fs.readFileSync(path.join(ROOT, "assets", "js", "store-status.js"), "utf8");
  assert.match(generatedCatalog, /store-status\.js/, "Public store pages must load the runtime status control.");
  assert.match(statusScript, /data-cart-add.*data-store-purchase.*data-cart-checkout-submit/s, "CLOSED handling must target add, buy, and checkout controls.");
  assert.match(statusScript, /control\.hidden = true/, "CLOSED handling must remove public purchase controls.");

  console.log("Store kill switch tests passed.");
}

function checkoutRequest() {
  return new Request("https://example.com/api/cart/checkout", { body: "{}", method: "POST" });
}

function stateDatabase(state) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { setting_value: state, updated_at: "2026-08-20T00:00:00.000Z", updated_by: "test" }; }
      };
    }
  };
}

function failingDatabase() {
  return { prepare() { throw new Error("D1 unavailable"); } };
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?test=${Date.now()}-${Math.random()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
