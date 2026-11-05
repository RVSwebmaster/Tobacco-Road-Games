const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const navigation = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "public-navigation.mjs")).href);
  const handler = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "progressive-navigation.mjs")).href);
  const ownerAccess = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "owner-access-identity.mjs")).href);

  assertMatrix(navigation.buildProgressiveNavigation);
  await assertOwnerAccess(ownerAccess.verifyOwnerAccessIdentity);
  await assertHandler(handler.handleProgressiveNavigationRequest);
  assertHomepageIntegration();
  assertProtectedRoutesRemainProtected();
  console.log("Progressive privilege navigation tests passed.");
}

function assertMatrix(build) {
  const guest = keys(build());
  assert.deepEqual(guest, ["explore", "forum", "creators", "ai-policy", "support", "account", "cart"]);
  assert.equal(build().items.find((item) => item.key === "account").label, "Join / Sign In");

  const customer = build({ authenticated: true, role: "user" });
  assert.deepEqual(customer.levels, ["guest", "customer"]);
  assert.deepEqual(keys(customer), ["explore", "forum", "creators", "creator-registration", "ai-policy", "support", "account", "library", "cart"]);
  assert.equal(customer.items.find((item) => item.key === "account").label, "My Account");

  const creator = build({ authenticated: true, creator: true, role: "user" });
  assert.deepEqual(creator.levels, ["guest", "customer", "creator"]);
  assert.ok(keys(creator).includes("creator-studio"));
  assert.ok(keys(creator).includes("library"));
  assert.ok(!keys(creator).includes("moderation"));
  assert.ok(!keys(creator).includes("owner-office"));

  const admin = build({ authenticated: true, role: "admin" });
  assert.deepEqual(admin.levels, ["guest", "customer", "creator", "admin"]);
  assert.ok(keys(admin).includes("moderation"));
  assert.ok(keys(admin).includes("creator-studio"), "Admin navigation must retain cumulative Creator capabilities.");
  assert.ok(!keys(admin).includes("owner-office"));

  const creatorAdmin = build({ authenticated: true, creator: true, role: "admin" });
  assert.deepEqual(creatorAdmin.levels, ["guest", "customer", "creator", "admin"]);
  assert.ok(keys(creatorAdmin).includes("creator-studio"));
  assert.ok(keys(creatorAdmin).includes("moderation"));

  const owner = build({ authenticated: true, role: "owner" });
  assert.deepEqual(owner.levels, ["guest", "customer", "creator", "admin", "owner"]);
  for (const key of ["library", "creator-studio", "moderation", "owner-office"]) assert.ok(keys(owner).includes(key));
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
  assert.ok(keys(owner).includes("creator-studio"));
  assert.ok(keys(owner).includes("owner-office"));

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
  assert.match(guestHomepage, /data-progressive-navigation/);
  assert.match(guestHomepage, /data-homepage-library/);
  assert.match(guestHomepage, /progressive-navigation\.js/);
  assert.ok(routes.include.includes("/api/navigation"), "Pages Functions must route the navigation endpoint.");
  assert.match(client, /prepareAuthenticatedGuestLibrary/);
  assert.match(styles, /\.homepage-library-book[\s\S]*?pointer-events:\s*auto;/);
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

function keys(state) { return state.items.map((item) => item.key); }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
