const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TAX_NOTE = "The listed price is the final price. Any applicable sales tax is included.";

async function main() {
  testCartStorageHelpers();
  testCartBrowserInitAndStorageSync();
  await testCartQuoteFailureAndRetry();
  await testCartUnavailableRemoval();
  testStoreGenerationCartMode();
  console.log("Storefront cart tests passed.");
}

function testCartStorageHelpers() {
  const { api, storage } = loadCartScript({
    document: createDocument(),
    storage: createStorage(),
    window: createWindow()
  });

  storage.setItem(api.STORAGE_KEY, "{not-valid-json");
  const resetCart = api.readCart(storage);
  assert.equal(resetCart.items.length, 0, "Malformed localStorage should reset to an empty cart.");
  assert.equal(resetCart.version, 1, "Reset cart should preserve the schema version.");

  api.addItem("agency", storage);
  api.addItem("agency", storage);
  let cart = api.readCart(storage);
  assert.equal(cart.items.length, 1, "Duplicate cart entries should be prevented.");
  assert.equal(cart.items[0].quantity, 1, "Cart quantity should remain fixed at 1.");

  api.addItem("sirrocans", storage);
  cart = api.readCart(storage);
  assert.equal(cart.items.length, 2, "Distinct products should be added to the cart.");
  assert.deepEqual(JSON.parse(JSON.stringify(api.createQuoteRequest(cart))), {
    items: [
      { quantity: 1, slug: "agency" },
      { quantity: 1, slug: "sirrocans" }
    ]
  }, "Quote requests should submit only slugs and fixed quantity.");

  api.removeItem("agency", storage);
  cart = api.readCart(storage);
  assert.deepEqual(Array.from(cart.items, (entry) => entry.slug), ["sirrocans"], "Removing a cart entry should persist.");
}

function testCartBrowserInitAndStorageSync() {
  const document = createDocument();
  const windowRef = createWindow();
  const storage = createStorage();
  const countBadge = createElement("0");
  const addButton = createElement("Add to Cart", {
    cartAdd: "agency"
  });
  document.register("[data-cart-count]", [countBadge]);
  document.register("[data-cart-add]", [addButton]);

  const { api } = loadCartScript({
    document,
    storage,
    window: windowRef
  });

  api.initBrowserCart({
    document,
    storage,
    window: windowRef
  });

  addButton.click();
  assert.equal(countBadge.textContent, "1", "Cart count should update after adding a product.");
  assert.equal(addButton.textContent, "In Cart", "Add buttons should reflect in-cart state.");

  storage.setItem(api.STORAGE_KEY, JSON.stringify({
    version: 1,
    items: [
      {
        addedAt: new Date().toISOString(),
        quantity: 1,
        slug: "agency"
      },
      {
        addedAt: new Date().toISOString(),
        quantity: 1,
        slug: "sirrocans"
      }
    ],
    updatedAt: new Date().toISOString()
  }));
  windowRef.dispatchStorageEvent(api.STORAGE_KEY);
  assert.equal(countBadge.textContent, "2", "Storage events should synchronize cart count across tabs.");
}

async function testCartQuoteFailureAndRetry() {
  const document = createCartPageDocument([
    {
      cover: "/product-assets/agency/cover.webp",
      currency: "USD",
      priceCents: 500,
      priceDisplay: "$5.00",
      slug: "agency",
      title: "Agency",
      url: "/store/products/agency/"
    }
  ]);
  const storage = createStorage();
  storage.setItem("trg_cart_v1", JSON.stringify({
    version: 1,
    items: [
      {
        addedAt: new Date().toISOString(),
        quantity: 1,
        slug: "agency"
      }
    ],
    updatedAt: new Date().toISOString()
  }));

  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount <= 2) {
      throw new Error("synthetic failure");
    }
    return createJsonResponse({
      includedTaxTotalCents: null,
      items: [
        {
          authorDisplay: "RV Sawyer",
          coverUrl: "/product-assets/agency/cover.webp",
          currency: "USD",
          effectivePriceCents: 400,
          lineTotalCents: 400,
          quantity: 1,
          regularPriceCents: 500,
          saleActive: true,
          slug: "agency",
          title: "Agency"
        }
      ],
      pricingNote: TAX_NOTE,
      quotedAt: new Date().toISOString(),
      subtotalCents: 400,
      taxInclusive: true,
      totalCents: 400,
      unavailableItems: []
    });
  };

  const { api } = loadCartScript({
    document,
    fetchImpl,
    storage,
    window: createWindow()
  });

  await api.renderAll(document, storage, { fetchImpl });
  assert.equal(document.totalLabel.textContent, "Estimated Total Only", "Quote failures should keep the total marked as an estimate.");
  assert.equal(document.total.textContent, "$5.00", "Quote failures should preserve the browser estimate.");
  assert.match(document.note.textContent, /estimates only/i, "Quote failures should warn that prices are estimates only.");
  assert.equal(document.retryButton.hidden, false, "Quote failures should expose a retry button.");
  assert.match(document.items.innerHTML, /Estimated price: \$5\.00/, "Estimated item pricing should render before quote recovery.");

  document.retryButton.click();
  await flushTasks();

  assert.equal(document.totalLabel.textContent, "Final Listed Total", "Retry should replace estimates with a verified total.");
  assert.equal(document.total.textContent, "$4.00", "Retry should render the verified server quote.");
  assert.equal(document.note.textContent, TAX_NOTE, "Retry should render the exact tax-inclusive pricing note.");
  assert.equal(document.retryButton.hidden, true, "Retry button should hide after quote recovery.");
  assert.match(document.items.innerHTML, /Verified sale price: \$4\.00/, "Verified item pricing should replace browser estimates.");
}

async function testCartUnavailableRemoval() {
  const document = createCartPageDocument([]);
  const storage = createStorage();
  storage.setItem("trg_cart_v1", JSON.stringify({
    version: 1,
    items: [
      {
        addedAt: new Date().toISOString(),
        quantity: 1,
        slug: "missing-book"
      }
    ],
    updatedAt: new Date().toISOString()
  }));

  const fetchImpl = async () => createJsonResponse({
    includedTaxTotalCents: null,
    items: [],
    pricingNote: TAX_NOTE,
    quotedAt: new Date().toISOString(),
    subtotalCents: 0,
    taxInclusive: true,
    totalCents: 0,
    unavailableItems: [
      {
        code: "unknown_slug",
        message: "This item is not available for checkout.",
        quantity: 1,
        slug: "missing-book"
      }
    ]
  });

  const { api } = loadCartScript({
    document,
    fetchImpl,
    storage,
    window: createWindow()
  });

  await api.renderAll(document, storage, { fetchImpl });
  assert.equal(document.unavailable.hidden, false, "Unavailable quote items should render in a dedicated state.");
  assert.match(document.unavailable.innerHTML, /This item is not available for checkout\./, "Unavailable items should explain why checkout is blocked.");

  const removeButtons = document.unavailable.querySelectorAll("[data-cart-remove]");
  assert.equal(removeButtons.length, 1, "Unavailable items should still be removable.");
  removeButtons[0].click();
  await flushTasks();

  const cart = api.readCart(storage);
  assert.equal(cart.items.length, 0, "Removing an unavailable item should persist to localStorage.");
  assert.equal(document.countBadge.textContent, "0", "Removing an unavailable item should update the cart badge.");
}

function testStoreGenerationCartMode() {
  const tempRoot = createTempRepo([
    "assets/js/cart.js",
    "data/authors.js",
    "data/bundle-rules.json",
    "data/products.json",
    "scripts/build-runtime-catalog.mjs",
    "scripts/build-store.js",
    "shared/pricing.js",
    "styles.css"
  ]);
  const productsPath = path.join(tempRoot, "data", "products.json");
  const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  const cartFixture = {
    ...products[0],
    slug: "cart-test-product",
    title: "Cart Test Product",
    subtitle: "A generated cart fixture",
    status: "available-direct",
    statusLabel: "Available Direct",
    buyMode: "cart",
    buyUrl: "",
    price: "4.99",
    priceCents: 499,
    saleEnabled: true,
    salePrice: "3.99",
    salePriceCents: 399,
    saleStart: "2026-01-01",
    saleEnd: "2027-12-31",
    coverImage: "/product-assets/cart-test-product/cover.webp",
    previewImage: "/product-assets/cart-test-product/preview.webp",
    frontCoverImage: "/product-assets/cart-test-product/cover.webp"
  };
  const fixedPriceFixture = {
    ...products[1],
    slug: "fixed-price-fixture",
    title: "Fixed Price Fixture",
    subtitle: "Preserve existing buy modes",
    status: "available-direct",
    statusLabel: "Available Direct",
    buyMode: "fixed-price",
    buyUrl: "https://example.com/buy/fixed-price-fixture",
    price: "2.99",
    priceCents: 299,
    coverImage: "/product-assets/fixed-price-fixture/cover.webp",
    previewImage: "/product-assets/fixed-price-fixture/preview.webp",
    frontCoverImage: "/product-assets/fixed-price-fixture/cover.webp"
  };
  products.push(cartFixture, fixedPriceFixture);
  fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);

  const build = spawnSync(process.execPath, [path.join(tempRoot, "scripts", "build-store.js")], {
    cwd: tempRoot,
    encoding: "utf8"
  });
  assert.equal(build.status, 0, `Cart fixture build should succeed. ${build.stderr || build.stdout}`);

  const cartProductPage = fs.readFileSync(path.join(tempRoot, "store", "products", "cart-test-product", "index.html"), "utf8");
  assert.match(cartProductPage, /Add to Cart/, "Cart product pages should render Add to Cart.");
  assert.match(cartProductPage, /assets\/js\/cart\.js\?v=/, "Cart product pages should load the shared cart script.");
  assert.match(cartProductPage, /data-cart-add="cart-test-product"/, "Cart product pages should expose the cart control slug.");
  assert.match(cartProductPage, /\$3\.99/, "Cart product pages should render the effective sale price.");

  const catalogPage = fs.readFileSync(path.join(tempRoot, "store", "catalog", "index.html"), "utf8");
  assert.match(catalogPage, /data-cart-add="cart-test-product"/, "Catalog cards should render Add to Cart for cart products.");
  assert.match(catalogPage, /data-price-cents="399"/, "Catalog cards should carry the effective price in dataset filters.");

  const cartPagePath = path.join(tempRoot, "store", "cart", "index.html");
  assert.ok(fs.existsSync(cartPagePath), "The generated cart page should exist.");
  const cartPage = fs.readFileSync(cartPagePath, "utf8");
  assert.match(cartPage, /data-cart-status/, "The cart page should include verified quote status messaging.");
  assert.match(cartPage, /data-cart-note/, "The cart page should include a quote note container.");
  assert.match(cartPage, /data-cart-total-label/, "The cart page should include a labeled total state.");
  assert.match(cartPage, /data-cart-retry/, "The cart page should include a retry control.");
  assert.match(cartPage, /data-cart-unavailable/, "The cart page should include an unavailable-item container.");
  assert.match(cartPage, /Checkout Unavailable In This Phase/, "The cart page should keep checkout disabled in this phase.");
  assert.match(cartPage, /\"priceCents\":399/, "Embedded cart catalog estimates should use the effective sale price.");

  const runtimeCatalogPath = path.join(tempRoot, "shared", "runtime-catalog.mjs");
  assert.ok(fs.existsSync(runtimeCatalogPath), "Store builds should generate the runtime catalog.");
  const runtimeCatalog = fs.readFileSync(runtimeCatalogPath, "utf8");
  assert.match(runtimeCatalog, /Do not hand-edit this file\./, "Generated runtime catalogs should be clearly marked as generated.");

  const fixedPricePage = fs.readFileSync(path.join(tempRoot, "store", "products", "fixed-price-fixture", "index.html"), "utf8");
  assert.match(fixedPricePage, />Buy Now</, "Existing fixed-price purchase modes should remain functional.");
}

function loadCartScript({ document, fetchImpl, storage, window }) {
  const scriptPath = path.join(ROOT, "assets", "js", "cart.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = {
    console,
    Date,
    Intl,
    JSON,
    fetch: fetchImpl || (async () => createJsonResponse({
      includedTaxTotalCents: null,
      items: [],
      pricingNote: TAX_NOTE,
      quotedAt: new Date().toISOString(),
      subtotalCents: 0,
      taxInclusive: true,
      totalCents: 0,
      unavailableItems: []
    })),
    localStorage: storage,
    document,
    window,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(script, context, {
    filename: scriptPath
  });
  return {
    api: context.TRGCart,
    document,
    storage,
    window
  };
}

function createTempRepo(relativePaths) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trg-store-cart-"));
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(ROOT, relativePath);
    const destinationPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return tempRoot;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function createDocument() {
  const queryMap = new Map();
  const elementsById = new Map();
  return {
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(selector) {
      const list = queryMap.get(selector) || [];
      return list[0] || null;
    },
    querySelectorAll(selector) {
      return queryMap.get(selector) || [];
    },
    register(selector, elements) {
      queryMap.set(selector, elements);
    },
    registerId(id, element) {
      elementsById.set(id, element);
    }
  };
}

function createCartPageDocument(catalogEntries) {
  const document = createDocument();
  document.pageRoot = createElement();
  document.items = createMarkupContainer();
  document.empty = createElement("Your cart is empty.");
  document.total = createElement("$0.00");
  document.totalLabel = createElement("Estimated Total");
  document.note = createElement("");
  document.status = createElement("");
  document.retryButton = createElement("Retry Verified Quote");
  document.retryButton.hidden = true;
  document.unavailable = createMarkupContainer();
  document.unavailable.hidden = true;
  document.clearButton = createElement("Clear Cart");
  document.countBadge = createElement("0");

  document.register("[data-cart-page]", [document.pageRoot]);
  document.register("[data-cart-items]", [document.items]);
  document.register("[data-cart-empty]", [document.empty]);
  document.register("[data-cart-total]", [document.total]);
  document.register("[data-cart-total-label]", [document.totalLabel]);
  document.register("[data-cart-note]", [document.note]);
  document.register("[data-cart-status]", [document.status]);
  document.register("[data-cart-retry]", [document.retryButton]);
  document.register("[data-cart-unavailable]", [document.unavailable]);
  document.register("[data-cart-clear]", [document.clearButton]);
  document.register("[data-cart-count]", [document.countBadge]);
  document.registerId("trg-cart-catalog", {
    textContent: JSON.stringify(catalogEntries)
  });

  return document;
}

function createElement(textContent = "", dataset = {}) {
  return {
    dataset: { ...dataset },
    disabled: false,
    hidden: false,
    innerHTML: "",
    listeners: new Map(),
    textContent,
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    click() {
      const handler = this.listeners.get("click");
      if (handler) {
        handler({
          currentTarget: this,
          preventDefault() {}
        });
      }
    },
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      this[name] = value;
    }
  };
}

function createMarkupContainer() {
  const element = createElement();
  const selectorMap = new Map();
  let markup = "";

  Object.defineProperty(element, "innerHTML", {
    enumerable: true,
    get() {
      return markup;
    },
    set(value) {
      markup = String(value || "");
      const removeButtons = Array.from(markup.matchAll(/data-cart-remove="([^"]+)"/g), (match) => createElement("Remove", {
        cartRemove: match[1]
      }));
      selectorMap.set("[data-cart-remove]", removeButtons);
    }
  });

  element.querySelectorAll = (selector) => selectorMap.get(selector) || [];
  return element;
}

function createWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchStorageEvent(key) {
      const handler = listeners.get("storage");
      if (handler) {
        handler({ key });
      }
    }
  };
}

function createJsonResponse(payload, status = 200) {
  return {
    async json() {
      return payload;
    },
    ok: status >= 200 && status < 300,
    status
  };
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
