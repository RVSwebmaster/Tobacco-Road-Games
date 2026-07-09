const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function main() {
  testCartStorageHelpers();
  testCartBrowserInitAndStorageSync();
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

function testStoreGenerationCartMode() {
  const tempRoot = createTempRepo([
    "assets/js/cart.js",
    "data/authors.js",
    "data/bundle-rules.json",
    "data/products.json",
    "scripts/build-store.js",
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
    saleEnabled: false,
    salePrice: "",
    salePriceCents: null,
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

  const catalogPage = fs.readFileSync(path.join(tempRoot, "store", "catalog", "index.html"), "utf8");
  assert.match(catalogPage, /data-cart-add="cart-test-product"/, "Catalog cards should render Add to Cart for cart products.");

  const cartPagePath = path.join(tempRoot, "store", "cart", "index.html");
  assert.ok(fs.existsSync(cartPagePath), "The generated cart page should exist.");
  const cartPage = fs.readFileSync(cartPagePath, "utf8");
  assert.match(cartPage, /Final product availability and pricing will be verified during checkout\./, "The cart page should explain estimated pricing.");
  assert.match(cartPage, /Checkout Unavailable In This Phase/, "The cart page should include a disabled checkout control.");
  assert.match(cartPage, /trg-cart-catalog/, "The cart page should include the embedded cart catalog.");

  const fixedPricePage = fs.readFileSync(path.join(tempRoot, "store", "products", "fixed-price-fixture", "index.html"), "utf8");
  assert.match(fixedPricePage, />Buy Now</, "Existing fixed-price purchase modes should remain functional.");
}

function loadCartScript({ document, window, storage }) {
  const scriptPath = path.join(ROOT, "assets", "js", "cart.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  const context = {
    console,
    Date,
    Intl,
    JSON,
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

function createElement(textContent = "", dataset = {}) {
  return {
    dataset: { ...dataset },
    disabled: false,
    hidden: false,
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

main();
