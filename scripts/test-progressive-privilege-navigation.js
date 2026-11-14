const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const navigation = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "public-navigation.mjs")).href);
  const handler = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "progressive-navigation.mjs")).href);
  const ownerAccess = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-access-identity.mjs")).href);
  const ownerBootstrap = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-session-bootstrap.mjs")).href);

  assertMatrix(navigation.buildProgressiveNavigation);
  assertPublicHeaders(navigation.renderPublicNavigation);
  await assertOwnerAccess(ownerAccess.verifyOwnerAccessIdentity);
  await assertHandler(handler.handleProgressiveNavigationRequest);
  await assertOwnerDocumentBootstrap(ownerBootstrap.attachOwnerSessionForDocument);
  assertHomepageIntegration();
  assertProtectedRoutesRemainProtected();
  assertCreatorSessionBootstrapScope();
  console.log("Progressive privilege navigation tests passed.");
}

function assertCreatorSessionBootstrapScope() {
  const middleware = fs.readFileSync(path.join(ROOT, "functions", "_middleware.js"), "utf8");
  assert.match(middleware, /pathname\.startsWith\("\/owner"\) \|\| pathname\.startsWith\("\/creator"\)/,
    "Owner Access must bootstrap the shared TRG session for the Creator workspace too.");
  assert.match(middleware, /return usesOwnerSessionBootstrap \? ownerResponse\(response, context\) : response/,
    "The Creator document response must receive the same session bootstrap as the Owner document.");
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
  assert.deepEqual(customer.items, guest);

  const creator = build({ authenticated: true, creator: true, role: "user" });
  assert.deepEqual(creator.levels, ["guest", "customer", "creator"]);
  assert.deepEqual(creator.items, guest);

  const admin = build({ authenticated: true, role: "admin" });
  assert.deepEqual(admin.levels, ["guest", "customer", "creator", "admin"]);
  assert.deepEqual(admin.items, guest);

  const creatorAdmin = build({ authenticated: true, creator: true, role: "admin" });
  assert.deepEqual(creatorAdmin.levels, ["guest", "customer", "creator", "admin"]);
  assert.deepEqual(creatorAdmin.items, guest);

  const owner = build({ authenticated: true, role: "owner" });
  assert.deepEqual(owner.levels, ["guest", "customer", "creator", "admin", "owner"]);
  assert.deepEqual(owner.items, guest);
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
  assert.deepEqual(owner.items, buildGuestItems());

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
  assert.deepEqual(bridgedOwner.items, buildGuestItems());
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
  assert.match(client, /prepareAuthenticatedGuestLibrary/);
  assert.match(styles, /\.homepage-library-book[\s\S]*?pointer-events:\s*auto;/);
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
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
