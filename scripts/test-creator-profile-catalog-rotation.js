const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const buildStore = require("./build-store.js");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "assets/js/creator-profile-catalog-rotation.js"), "utf8");
const creatorPage = fs.readFileSync(path.join(ROOT, "creator/index.html"), "utf8");
const dashboardPage = fs.readFileSync(path.join(ROOT, "creator-dashboard/index.html"), "utf8");
const guestPage = fs.readFileSync(path.join(ROOT, "guest/index.html"), "utf8");
const creatorCss = fs.readFileSync(path.join(ROOT, "assets/css/member-profile.css"), "utf8");
const renderedCreatorPage = buildStore.renderMemberProfilePage(guestPage, { canonicalPath: "/creator/", creatorCatalogRotation: true });

assert.equal(renderedCreatorPage.replace(/\r\n/g, "\n"), creatorPage.replace(/\r\n/g, "\n"), "The Creator Profile output matches its canonical generator.");
assert.match(creatorPage, /data-creator-profile-catalog-cover/);
assert.match(creatorPage, /creator-profile-catalog-rotation\.js\?v=creator-catalog-cover-rotation1/);
assert.match(creatorCss, /\.creator-profile-catalog-cover[\s\S]*clip-path:\s*inset\(2\.2% 11\.6% 2%\)/,
  "The rotating artwork stays inside the current poster-frame pixels.");
assert.doesNotMatch(dashboardPage, /data-creator-profile-catalog-cover|creator-profile-catalog-rotation\.js/,
  "The private Creator Dashboard keeps its existing static poster.");
assert.match(dashboardPage, /src="\/assets\/the-familiar-framed-poster\.png"/);

function harness({ search = "", stored = "", responseProducts = [], reduced = false, identityStatus = 200, catalogStatus = 200 } = {}) {
  const cover = { src: "/assets/the-familiar-framed-poster.png", dataset: { catalogApi: "/api/catalog" } };
  const listeners = {};
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  const document = {
    hidden: false,
    querySelector(selector) { return selector === "[data-creator-profile-catalog-cover]" ? cover : null; },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  const window = {
    location: { origin: "https://tobaccoroadgames.com", search },
    localStorage: { getItem: () => stored },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    setInterval(handler, delay) { const id = nextTimer++; timers.set(id, { handler, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/creator/identity-options") {
        return { ok: identityStatus === 200, json: async () => ({ creators: [
          { id: "creator-one", slug: "one" }, { id: "creator-two", slug: "two" }
        ] }) };
      }
      if (String(url).startsWith("/api/catalog?")) {
        return { ok: catalogStatus === 200, json: async () => ({ products: responseProducts }) };
      }
      throw new Error(`Unexpected request ${url}`);
    }
  };
  vm.runInNewContext(source, { document, window, URL, URLSearchParams });
  return { cover, calls, timers, listeners, document, async settle() { await new Promise(resolve => setImmediate(resolve)); } };
}

(async () => {
  const scoped = harness({ search: "?creator=two", stored: "creator-one", responseProducts: [
    { id: "foreign", creatorId: "creator-one", storefrontVisibility: "listed", coverUrl: "/product-assets/foreign/cover.webp" },
    { id: "unlisted", creatorId: "creator-two", storefrontVisibility: "unlisted", coverUrl: "/product-assets/unlisted/cover.webp" },
    { id: "external", creatorId: "creator-two", storefrontVisibility: "listed", coverUrl: "https://evil.invalid/cover.webp" },
    { id: "two-a", creatorId: "creator-two", storefrontVisibility: "listed", coverUrl: "/product-assets/two-a/cover.webp" },
    { id: "two-b", creatorId: "creator-two", storefrontVisibility: "listed", coverUrl: "/product-assets/two-b/cover.webp" }
  ] });
  await scoped.settle();
  assert.match(scoped.calls[1].url, /creatorId=creator-two/,
    "A URL-selected Creator identity takes precedence over stored selection.");
  assert.equal(scoped.cover.src, "/product-assets/two-a/cover.webp");
  assert.equal(scoped.cover.dataset.activeProductId, "two-a");
  assert.equal(scoped.timers.size, 1);
  const timer = [...scoped.timers.values()][0];
  assert.equal(timer.delay, 45_000);
  timer.handler();
  assert.equal(scoped.cover.src, "/product-assets/two-b/cover.webp");
  timer.handler();
  assert.equal(scoped.cover.src, "/product-assets/two-a/cover.webp", "Rotation wraps without changing catalog order.");

  scoped.document.hidden = true;
  scoped.listeners.visibilitychange();
  assert.equal(scoped.timers.size, 0, "The timer stops while the page is hidden.");
  scoped.document.hidden = false;
  scoped.listeners.visibilitychange();
  assert.equal([...scoped.timers.values()][0].delay, 45_000, "A visible page resumes with a fresh 45-second interval.");

  const storedChoice = harness({ stored: "two", responseProducts: [
    { id: "two-only", creatorId: "creator-two", storefrontVisibility: "listed", coverUrl: "/product-assets/two-only/cover.webp" }
  ] });
  await storedChoice.settle();
  assert.match(storedChoice.calls[1].url, /creatorId=creator-two/, "Stored Creator selection is honored when no URL selection exists.");
  assert.equal(storedChoice.cover.src, "/product-assets/two-only/cover.webp");
  assert.equal(storedChoice.timers.size, 0, "A single cover remains stable.");

  const reduced = harness({ reduced: true, responseProducts: [
    { id: "r1", creatorId: "creator-one", storefrontVisibility: "listed", coverUrl: "/product-assets/r1/cover.webp" },
    { id: "r2", creatorId: "creator-one", storefrontVisibility: "listed", coverUrl: "/product-assets/r2/cover.webp" }
  ] });
  await reduced.settle();
  assert.equal(reduced.cover.src, "/product-assets/r1/cover.webp");
  assert.equal(reduced.timers.size, 0, "Reduced-motion preference disables automatic cover changes.");

  const empty = harness({ responseProducts: [] });
  await empty.settle();
  assert.equal(empty.cover.src, "/assets/the-familiar-framed-poster.png", "No authored covers leaves the familiar framed fallback intact.");
  assert.equal(empty.timers.size, 0);

  const unauthorized = harness({ identityStatus: 401, responseProducts: [
    { id: "private", creatorId: "creator-one", storefrontVisibility: "listed", coverUrl: "/product-assets/private/cover.webp" }
  ] });
  await unauthorized.settle();
  assert.equal(unauthorized.calls.length, 1, "Catalog fetch requires the authenticated Creator identity feed.");
  assert.equal(unauthorized.cover.src, "/assets/the-familiar-framed-poster.png");

  const unavailable = harness({ catalogStatus: 503 });
  await unavailable.settle();
  assert.equal(unavailable.cover.src, "/assets/the-familiar-framed-poster.png", "Catalog errors preserve the framed fallback.");
  assert.equal(unavailable.timers.size, 0);

  console.log("Creator Profile catalog cover rotation regression passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
