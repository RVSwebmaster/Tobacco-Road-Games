const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const navigation = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "public-navigation.mjs")).href);
  const handler = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "progressive-navigation.mjs")).href);
  const ownerAccess = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-access-identity.mjs")).href);
  const ownerBootstrap = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-session-bootstrap.mjs")).href);

  const dashboardNavigation = fs.readFileSync(path.join(ROOT, "assets", "js", "progressive-navigation.js"), "utf8");
  assert.match(dashboardNavigation, /state\.levels\.includes\("customer"\) && \(!state\.levels\.includes\("admin"\) \|\| state\.levels\.includes\("owner"\)\)/,
    "Owner receives Dashboard navigation while the excluded Admin role does not.");
  assertMatrix(navigation.buildProgressiveNavigation);
  assertPublicHeaders(navigation.renderPublicNavigation);
  await assertOwnerAccess(ownerAccess.verifyOwnerAccessIdentity);
  await assertHandler(handler.handleProgressiveNavigationRequest);
  await assertOwnerDocumentBootstrap(ownerBootstrap.attachOwnerSessionForDocument);
  assertHomepageIntegration();
  await assertCustomerLibraryUsesSharedOpenRulesBinding();
  await assertCustomerLogoutStaysInStaging();
  assertProtectedRoutesRemainProtected();
  await assertCreatorSessionBootstrapBehavior();
  console.log("Progressive privilege navigation tests passed.");
}

async function assertCreatorSessionBootstrapBehavior() {
  const source = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8")
    .replace(/^import .*;\s*$/gm, "")
    .replace("export async function onRequest(context)", "async function onRequest(context)")
    + "\nglobalThis.trgOnRequest = onRequest;";
  const bootstrappedPaths = [];
  let accountClass = "customer";
  let creatorDashboardAvailable = false;
  let sessionValid = true;
  const sandbox = {
    URL,
    Request,
    Response,
    Headers,
    HTMLRewriter: class TestHTMLRewriter {
      on() { return this; }
      transform(response) { return response; }
    },
    isMarketplaceWriteDisabled: () => false,
    marketplaceWriteDisabledResponse: () => new Response("writes disabled", { status: 503 }),
    handleOfficeMiddleware: async () => new Response("office"),
    readStoreState: async () => ({ available: false }),
    isPublicStorePage: () => false,
    maintenanceResponse: () => new Response("maintenance"),
    getCustomerSessionFromRequest: async () => ({ valid: sessionValid, user: { id: "test-user", role: "user" } }),
    resolveMemberProfileAccess: async () => ({ accountClass, creatorDashboardAvailable }),
    attachOwnerSessionForDocument: async (response, request) => {
      const pathname = new URL(request.url).pathname;
      bootstrappedPaths.push(pathname);
      const headers = new Headers(response.headers);
      headers.set("x-test-owner-session-bootstrap", pathname);
      return new Response(response.body, { status: response.status, headers });
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "functions/_middleware.js" });
  const request = (pathname) => new Request(`https://staging.example${pathname}`);
  const creatorResponse = await sandbox.trgOnRequest({
    request: request("/creator/"),
    env: {},
    next: async () => new Response("Creator document", { headers: { "content-type": "text/html" } })
  });
  assert.equal(creatorResponse.headers.get("x-test-owner-session-bootstrap"), "/creator/",
    "The Creator Profile response receives the shared session bootstrap.");
  assert.equal(await creatorResponse.text(), "Creator document");

  const customerResponse = await sandbox.trgOnRequest({
    request: request("/customer"),
    env: {},
    next: async () => new Response("Customer document", { headers: { "content-type": "text/plain" } })
  });
  assert.equal(customerResponse.headers.has("x-test-owner-session-bootstrap"), false,
    "Customer storefront requests do not use the Owner/Creator document bootstrap.");

  const nextText = async (pathname) => sandbox.trgOnRequest({
    request: request(pathname),
    env: { TRG_ORDERS: {} },
    next: async () => new Response("Member document", { headers: { "content-type": "text/html" } })
  });
  accountClass = "creator";
  let loginResponse = await nextText("/account.html");
  assert.equal(loginResponse.status, 302, "Signed-in members are redirected away from the obsolete account login page.");
  assert.equal(new URL(loginResponse.headers.get("location")).pathname, "/creator/",
    "The obsolete login destination returns a Creator to the existing Creator Profile.");
  assert.match(loginResponse.headers.get("cache-control"), /no-store/,
    "The signed-in account redirect is not cached between members.");
  accountClass = "customer";
  loginResponse = await nextText("/account.html");
  assert.equal(new URL(loginResponse.headers.get("location")).pathname, "/customer-profile/",
    "A signed-in Customer returns to the existing Customer Profile.");
  accountClass = "admin";
  loginResponse = await nextText("/account.html");
  assert.equal(loginResponse.status, 200, "Admin login routing remains outside the membership Dashboard change.");
  accountClass = "customer";
  sessionValid = false;
  loginResponse = await nextText("/account.html");
  assert.equal(loginResponse.status, 200, "Signed-out visitors retain the existing Login/Signup page.");
  sessionValid = true;
  let membershipResponse = await nextText("/customer-profile/");
  assert.equal(membershipResponse.status, 200, "Signed-in Customer can open the Membership Dashboard in their Profile.");
  accountClass = "creator";
  membershipResponse = await nextText("/customer-profile/");
  assert.equal(membershipResponse.status, 302);
  assert.equal(new URL(membershipResponse.headers.get("location")).pathname, "/creator/",
    "Other membership classes stay on their existing Profile routes.");
  accountClass = "customer";
  membershipResponse = await nextText("/dashboard/");
  assert.equal(membershipResponse.status, 200, "Customer opens the shared Membership Dashboard.");
  membershipResponse = await nextText("/dashboard/?page=creator");
  assert.equal(membershipResponse.status, 403, "Customer cannot request a Creator workspace.");
  for (const [tier, allowedPages] of [
    ["creator", ["membership", "creator"]],
    ["premiumCreator", ["membership", "creator", "premier"]],
    ["founding25", ["membership", "creator", "premier", "founding-25"]],
    ["owner", ["membership", "creator", "premier", "founding-25", "owner"]],
  ]) {
    accountClass = tier;
    for (const page of allowedPages) {
      membershipResponse = await nextText(`/dashboard/?page=${page}`);
      assert.equal(membershipResponse.status, 200, `${tier} can access ${page}.`);
    }
    const nextPage = ["creator", "premier", "founding-25", "owner"][allowedPages.length - 1];
    if (nextPage) {
      membershipResponse = await nextText(`/dashboard/?page=${nextPage}`);
      if (!allowedPages.includes(nextPage)) assert.equal(membershipResponse.status, 403, `${tier} cannot access ${nextPage}.`);
    }
  }
  accountClass = "creator";
  membershipResponse = await nextText("/creator-dashboard/");
  assert.equal(membershipResponse.status, 302);
  assert.equal(new URL(membershipResponse.headers.get("location")).searchParams.get("page"), "creator",
    "The retired Creator Dashboard URL forwards into the shared Creator tab.");
  creatorDashboardAvailable = true;
  membershipResponse = await nextText("/creator-tools/");
  assert.equal(membershipResponse.status, 200, "Existing Creator operations remain available through their preserved tools route.");
  accountClass = "admin";
  membershipResponse = await nextText("/dashboard/");
  assert.equal(membershipResponse.status, 403, "Admin remains outside the membership Dashboard hierarchy.");
  accountClass = "customer";
  sessionValid = false;
  membershipResponse = await nextText("/customer-profile/");
  assert.equal(membershipResponse.status, 302);
  assert.equal(new URL(membershipResponse.headers.get("location")).pathname, "/account.html",
    "Signed-out visitors cannot open the private Customer Membership workspace.");
  assert.deepEqual(bootstrappedPaths, ["/creator/", "/creator-tools/"], "Creator Profile and protected Creator tools use the established identity bootstrap.");
}

async function assertOwnerDocumentBootstrap(attach) {
  const html = () => new Response("<html>owner</html>", { headers: { "content-type": "text/html" } });
  const request = new Request("https://staging.example/owner/product-intake.html", {
    headers: { accept: "text/html", cookie: "CF_Authorization=access" },
  });
  let establishedEmail = "";
  let response = await attach(html(), request, {}, {
    getSession: async () => ({ valid: false }),
    verifyAccess: async () => ({ valid: true, email: "owner@example.test" }),
    establishSession: async (_env, email) => {
      establishedEmail = email;
      return { cookieHeaders: ["__Host-trg_session=owner-session; Path=/; Secure; HttpOnly", "trg_account_csrf=owner-csrf; Path=/; Secure"] };
    },
  });
  assert.equal(establishedEmail, "owner@example.test");
  assert.match(response.headers.get("set-cookie"), /__Host-trg_session=owner-session/);
  assert.match(response.headers.get("set-cookie"), /trg_account_csrf=owner-csrf/);

  let accessChecked = false;
  response = await attach(html(), request, {}, {
    getSession: async () => ({ valid: true }),
    verifyAccess: async () => { accessChecked = true; return { valid: false }; },
  });
  assert.equal(accessChecked, false, "A valid D1 session is reused without another Access bootstrap.");
  assert.equal(response.headers.has("set-cookie"), false);

  response = await attach(html(), new Request(request, { method: "POST" }), {}, {
    getSession: async () => ({ valid: false }),
    verifyAccess: async () => { throw new Error("non-document request must not bootstrap"); },
  });
  assert.equal(response.headers.has("set-cookie"), false);
}

function assertMatrix(build) {
  const guest = build().items;
  assert.deepEqual(guest, [
    { key: "explore", href: "/store/catalog/", label: "Explore" },
    { key: "support", href: "/support.html", label: "Support" },
    { key: "account", href: "/account.html", label: "Login/Signup" },
    { key: "cart", href: "/store/cart/", label: "Cart" }
  ]);

  const customer = build({ authenticated: true, role: "user" });
  assert.deepEqual(customer.levels, ["guest", "customer"]);
  assert.deepEqual(customer.items, buildMemberItems());
  assert.ok(!customer.items.some((item) => item.href === "/account.html"), "Authenticated navigation does not contain the signed-out Login/Signup destination.");

  const creator = build({ authenticated: true, creator: true, role: "user" });
  assert.deepEqual(creator.levels, ["guest", "customer", "creator"]);
  assert.deepEqual(creator.items, buildMemberItems());

  const admin = build({ authenticated: true, role: "admin" });
  assert.deepEqual(admin.levels, ["guest", "customer", "creator", "admin"]);
  assert.deepEqual(admin.items, buildMemberItems());

  const creatorAdmin = build({ authenticated: true, creator: true, role: "admin" });
  assert.deepEqual(creatorAdmin.levels, ["guest", "customer", "creator", "admin"]);
  assert.deepEqual(creatorAdmin.items, buildMemberItems());

  const owner = build({ authenticated: true, role: "owner" });
  assert.deepEqual(owner.levels, ["guest", "customer", "creator", "admin", "owner"]);
  assert.deepEqual(owner.items, buildMemberItems());
}

async function assertHandler(handle) {
  let response = await handle(new Request("https://example.test/api/navigation"), {}, {
    getSession: async () => ({ valid: false })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authenticated, false);

  response = await handle(new Request("https://example.test/api/navigation"), {}, {
    getSession: async () => ({ valid: true, user: { id: "creator-user", role: "user" } }),
    hasCreatorMembership: async (userId) => userId === "creator-user"
  });
  const creator = await response.json();
  assert.deepEqual(creator.levels, ["guest", "customer", "creator"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");

  response = await handle(new Request("https://example.test/api/navigation"), {}, {
    getSession: async () => ({ valid: true, user: { id: "owner-user", role: "owner" } }),
    hasCreatorMembership: async () => false
  });
  const owner = await response.json();
  assert.deepEqual(owner.levels, ["guest", "customer", "creator", "admin", "owner"]);
  assert.deepEqual(owner.items, buildMemberItems());

  response = await handle(new Request("https://example.test/api/navigation"), {}, {
    getSession: async () => ({ valid: false }),
    verifyOwnerAccess: async () => ({ valid: true, email: "owner@example.test" }),
    establishOwnerSession: async (_env, email) => {
      assert.equal(email, "owner@example.test");
      return { cookieHeaders: ["__Host-trg_session=session; Path=/; Secure; HttpOnly", "trg_account_csrf=csrf; Path=/; Secure"] };
    }
  });
  const bridgedOwner = await response.json();
  assert.deepEqual(bridgedOwner.levels, ["guest", "customer", "creator", "admin", "owner"]);
  assert.deepEqual(bridgedOwner.items, buildMemberItems());
  assert.match(response.headers.get("set-cookie"), /__Host-trg_session=session/);
  assert.match(response.headers.get("set-cookie"), /trg_account_csrf=csrf/);

  response = await handle(new Request("https://example.test/api/navigation", { method: "POST" }), {});
  assert.equal(response.status, 405);
}

async function assertOwnerAccess(verify) {
  const request = new Request("https://example.test/api/navigation", {
    headers: { cookie: "CF_Authorization=owner-access-token" }
  });
  const result = await verify(request, {
    OWNER_ACCESS_AUD: "owner-audience",
    OWNER_ACCESS_EMAIL: "owner@example.test",
    OWNER_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com"
  }, {
    jwks: {},
    jwtVerify: async (token, _jwks, options) => {
      assert.equal(token, "owner-access-token");
      assert.equal(options.audience, "owner-audience");
      assert.equal(options.issuer, "https://team.cloudflareaccess.com");
      return { payload: { email: "OWNER@example.test", sub: "owner-subject" } };
    }
  });
  assert.deepEqual(result, { valid: true, email: "owner@example.test" });
}

function assertHomepageIntegration() {
  const homepage = read("index.html");
  const guestHomepage = read("guest/index.html");
  const client = read("assets/js/progressive-navigation.js");
  const build = read("scripts/build-store.js");
  const redirects = read("_redirects");
  const routes = JSON.parse(read("_routes.json"));
  const styles = read("styles.css");
  assert.match(homepage, /data-progressive-navigation/);
  assert.equal((homepage.match(/data-personal-library/g) || []).length, 2);
  assert.match(homepage, /progressive-navigation\.js/);
  assert.match(client, /\/api\/navigation/);
  assert.match(client, /\/api\/account\/library/);
  assert.match(client, /The server-rendered Guest navigation is the fail-closed fallback/);
  assert.match(build, /data-progressive-navigation/);
  assert.match(build, /data-personal-library/);
  assert.match(redirects, /^\/ \/guest\/ 200\s*$/m, "The polished Guest homepage remains the root document.");
  assert.doesNotMatch(guestHomepage, /data-progressive-navigation|data-homepage-library|progressive-navigation\.js/);
  const account = read("account.html");
  assert.match(account, /data-progressive-navigation/);
  assert.match(account, /progressive-navigation\.js/);
  assert.doesNotMatch(account, /Creator Login \/ Sign Up/);
  assert.ok(routes.include.includes("/api/navigation"), "Pages Functions must route the navigation endpoint.");
  assert.ok(routes.include.includes("/account.html"), "Pages Functions must route the account page so signed-in members can be redirected away from the retired login destination.");
  assert.match(client, /prepareAuthenticatedGuestLibrary/);
  assert.match(styles, /\.homepage-library-book[\s\S]*?pointer-events:\s*auto;/);
}

async function assertCustomerLibraryUsesSharedOpenRulesBinding() {
  const sharedLibrarySource = read("assets/js/open-rules-library.js");
  const navigationSource = read("assets/js/progressive-navigation.js");
  const customerPage = read("customer.html");
  const sharedLibraryScript = customerPage.indexOf("/assets/js/open-rules-library.js");
  const navigationScript = customerPage.indexOf("/assets/js/progressive-navigation.js");
  assert.ok(sharedLibraryScript >= 0 && navigationScript > sharedLibraryScript,
    "Customer loads the shared Open Rules library before progressive navigation.");

  const makeElement = (tagName = "div") => ({
    tagName: tagName.toUpperCase(),
    dataset: Object.create(null),
    attributes: Object.create(null),
    children: [],
    classList: { remove() {} },
    style: { setProperty() {} },
    textContent: "",
    href: "",
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
    append(...children) {
      for (const child of children) {
        this.children.push(child);
        if (child && typeof child === "object") child.parentNode = this;
      }
    },
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    },
    before(child) {
      const parent = this.parentNode;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      if (index < 0) return;
      parent.children.splice(index, 0, child);
      child.parentNode = parent;
    },
    getBoundingClientRect() { return { width: 640 }; }
  });

  const cartCount = makeElement("span");
  cartCount.dataset.cartCount = "";
  cartCount.textContent = "0";
  const nav = makeElement("nav");
  nav.dataset.memberProfileRoutes = JSON.stringify({ customer: "/customer-profile/" });
  nav.append(cartCount);
  nav.querySelector = (selector) => {
    if (selector === "[data-cart-count]") {
      return nav.children.find((child) => Object.hasOwn(child.dataset, "cartCount")) || null;
    }
    if (selector === "[data-customer-logout]") {
      return nav.children.find((child) => Object.hasOwn(child.dataset, "customerLogout")) || null;
    }
    return null;
  };

  const row = makeElement("div");
  const shelves = makeElement("div");
  shelves.setAttribute = (name, value) => { shelves.attributes[name] = String(value); };
  const bay = makeElement("section");
  bay.querySelector = (selector) => selector === ".shop-wall-shelves--library" ? shelves : null;
  bay.querySelectorAll = (selector) => selector === "[data-customer-library-row]" ? [row] : [];
  row.querySelector = () => null;

  const events = [];
  const document = {
    querySelector(selector) {
      if (selector === "[data-progressive-navigation]") return nav;
      if (selector === "[data-customer-storefront]") return makeElement("main");
      if (selector === "[data-customer-storefront] .guest-library-bay[data-homepage-library]") return bay;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-customer-storefront] [data-customer-library-row]" ? [row] : [];
    },
    createElement: makeElement,
    dispatchEvent(event) { events.push(event); }
  };

  const libraryCalls = [];
  const sandbox = {
    document,
    URL,
    location: {
      origin: "https://example.test",
      pathname: "/customer",
      replace() {}
    },
    window: { innerWidth: 1280 },
    CustomEvent: class TestCustomEvent {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    },
    fetch: async (url) => {
      if (url === "/api/navigation") {
        return { ok: true, json: async () => ({
          authenticated: true,
          levels: ["guest", "customer"],
          items: buildMemberItems()
        }) };
      }
      if (url === "/api/account/library") {
        return { ok: true, json: async () => ({ items: [{
          productId: "owned-book",
          productTitle: "Owned Book",
          creator: "Test Creator",
          coverImage: "/assets/owned-book.webp",
          downloadUrl: "/account.html#library-panel"
        }] }) };
      }
      if (url === "/api/account/me") {
        return { ok: true, json: async () => ({ authenticated: true, user: { accountClass: "customer" } }) };
      }
      throw new Error(`Unexpected Customer navigation request: ${url}`);
    }
  };

  vm.runInNewContext(sharedLibrarySource, sandbox, { filename: "assets/js/open-rules-library.js" });
  const sharedLibrary = sandbox.window.TRGOpenRulesLibrary;
  assert.ok(Object.isFrozen(sharedLibrary), "The shared Open Rules API is published as a frozen window object.");
  assert.equal(typeof sharedLibrary.createOpenRulesShelfBook, "function");
  assert.equal(Object.hasOwn(sandbox, "openRules"), false, "No bare openRules global is supplied to the Customer page.");
  assert.equal(Object.hasOwn(sandbox.window, "openRules"), false, "The shared API is not aliased as window.openRules.");
  sandbox.window.TRGOpenRulesLibrary = Object.freeze({
    ...sharedLibrary,
    createOpenRulesShelfBook(product, position, baseWidth) {
      libraryCalls.push({ product, position, baseWidth });
      return makeElement("a");
    }
  });

  vm.runInNewContext(navigationSource, sandbox, { filename: "assets/js/progressive-navigation.js" });
  await new Promise((resolve) => setImmediate(resolve));

  const authenticatedLabels = nav.children.map((child) => child.textContent);
  assert.ok(authenticatedLabels.includes("Dashboard"), "Authenticated Customers receive the shared Dashboard link.");
  assert.ok(authenticatedLabels.includes("Logout"), "Authenticated Customers retain sign-out controls.");
  assert.ok(!authenticatedLabels.includes("Login/Signup"), "Authenticated navigation omits Login/Signup.");
  assert.ok(!nav.children.some((child) => child.href === "/account.html"), "Authenticated navigation does not link to the obsolete login destination.");
  assert.equal(libraryCalls.length, 1,
    "Authenticated Customer library rendering calls the shared Open Rules book factory.");
  assert.equal(libraryCalls[0].product.slug, "owned-book");
  assert.equal(libraryCalls[0].position, 0);
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].className, "shop-wall-library-books");
  assert.equal(row.children[0].children.length, 1);
  assert.equal(events[0]?.detail.count, 1);
}

async function assertCustomerLogoutStaysInStaging() {
  const source = read("assets/js/progressive-navigation.js");

  async function logoutFrom(origin) {
    const listeners = new Map();
    const replacements = [];
    const nav = {
      dataset: { memberProfileRoutes: JSON.stringify({ customer: "/customer-profile/" }) },
      children: [],
      querySelector(selector) {
        if (selector === "[data-cart-count]") return this.children.find((child) => child.dataset.cartCount !== undefined) || null;
        if (selector === "[data-customer-logout]") return this.children.find((child) => child.dataset.customerLogout !== undefined) || null;
        return null;
      },
      replaceChildren(...children) { this.children = children; },
    };
    const makeElement = () => ({
      dataset: {},
      children: [],
      addEventListener(type, listener) { listeners.set(type, listener); },
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      before(child) { nav.children.splice(nav.children.indexOf(this), 0, child); },
    });
    const location = {
      origin,
      hostname: new URL(origin).hostname,
      pathname: "/customer",
      replace(url) { replacements.push(url); },
    };
    const sandbox = {
      URL,
      document: {
        querySelector(selector) {
          if (selector === "[data-progressive-navigation]") return nav;
          if (selector === "[data-customer-storefront]") return {};
          return null;
        },
        createElement: makeElement,
      },
      location,
      window: { alert(message) { throw new Error(message); } },
      fetch: async (url) => {
        if (url === "/api/navigation") return { ok: true, json: async () => ({
          authenticated: true,
          levels: ["guest", "customer"],
          items: buildMemberItems(),
        }) };
        if (url === "/api/account/library") return { ok: true, json: async () => ({ items: [] }) };
        if (url === "/api/account/me") return { ok: true, json: async () => ({ authenticated: true, user: { accountClass: "customer" } }) };
        if (url === "/api/auth/logout") return { ok: true, json: async () => ({ ok: true }) };
        throw new Error(`Unexpected logout test request: ${url}`);
      },
    };
    vm.runInNewContext(source, sandbox, { filename: "assets/js/progressive-navigation.js" });
    await new Promise((resolve) => setImmediate(resolve));
    const logout = nav.children.find((child) => child.dataset.customerLogout !== undefined);
    assert.ok(logout, "Authenticated Customer navigation includes Logout.");
    await listeners.get("click")();
    assert.deepEqual(replacements, [
      new URL(origin).hostname.endsWith(".pages.dev")
        ? `${origin}/guest/`
        : "https://tobaccoroadgames.com/",
    ]);
  }

  await logoutFrom("https://staging.tobacco-road-games-staging.pages.dev");
  await logoutFrom("https://tobaccoroadgames.com");
}

function assertPublicHeaders(renderPublicNavigation) {
  const pages = [
    "index.html", "guest/index.html", "account.html", "support.html", "ai-policy.html",
    "authors.html", "authors/rv-sawyer/index.html", "creators/index.html",
    "creators/rv-sawyer/index.html", "store/index.html", "store/catalog/index.html",
    "store/cart/index.html", "store/open-rules-library/index.html",
    "store/authors/index.html", "store/authors/rv-sawyer/index.html",
    "store/bundles/bundle-what-you-want/index.html", "best-sellers-bookshelf-preview.html",
    "launch-week/index.html",
    ...fs.readdirSync(path.join(ROOT, "guest", "preview-products"))
      .map((slug) => `guest/preview-products/${slug}/index.html`)
  ];
  for (const page of pages) assertGuestLinks(read(page), page);
  assertGuestLinks(renderPublicNavigation(), "server-rendered public navigation");
  assertGuestLinks(read("functions/_lib/public-storefront.mjs"), "dynamic product navigation");
}

function assertGuestLinks(source, label) {
  const nav = source.match(/<nav class="site-nav" aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, `${label} has no primary navigation`);
  const links = [...nav.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => [match[1], match[2].replace(/<[^>]+>/g, "").replace(/\s+0$/, "").trim()]);
  assert.deepEqual(links, [
    ["/store/catalog/", "Explore"], ["/support.html", "Support"],
    ["/account.html", "Login/Signup"], ["/store/cart/", "Cart"]
  ], `${label} must use the original Guest navigation`);
}

function assertProtectedRoutesRemainProtected() {
  const creator = read("functions/_lib/creator-operations.mjs");
  const moderation = read("functions/_lib/forum-moderation.mjs");
  const ownerReview = read("functions/_lib/creator-review.mjs");
  assert.match(creator, /getSessionFromRequest/);
  assert.match(creator, /creator_access_denied/);
  assert.match(moderation, /MODERATOR_ROLES = Object\.freeze\(\["owner", "admin"\]\)/);
  assert.match(ownerReview, /OWNER_ROLES = new Set\(\["owner", "admin"\]\)/);
}

function buildGuestItems() { return [
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "support", href: "/support.html", label: "Support" },
  { key: "account", href: "/account.html", label: "Login/Signup" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]; }
function buildMemberItems() { return [
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "support", href: "/support.html", label: "Support" },
  { key: "member", label: "Member" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]; }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
