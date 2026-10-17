const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  verifyLocalWorkbenchConfiguration();
  const localAccess = await importModule("functions/_lib/owner-local-access.mjs");
  const middleware = await importModule("functions/_lib/owner-middleware.mjs");
  const mutationAuth = await importModule("functions/_lib/owner-mutation-auth.mjs");
  const publicBypass = await importModule("functions/_lib/owner-public-bypass.mjs");
  const env = {
    LOCAL_OWNER_BYPASS: "1",
    OWNER_CSRF_SECRET: "focused-local-owner-test-secret"
  };

  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("http://127.0.0.1:8788/owner/"), env), true);
  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("http://localhost:8788/owner/"), env), true);
  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("https://tobacco-road-games-staging.pages.dev/owner/"), env), false);
  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("http://127.0.0.1:8788/owner/"), {}), false);
  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("http://127.0.0.1:8788/owner/", {
    headers: { "cf-connecting-ip": "203.0.113.8" }
  }), env), false);
  assert.equal(localAccess.isLocalOwnerAccessRequest(new Request("http://127.0.0.1:8788/owner/", {
    headers: { "x-forwarded-host": "public.example" }
  }), env), false);

  const ownerPageResponse = await middleware.handleOwnerMiddleware({
    env,
    next: () => new Response("owner dashboard", { status: 200 }),
    request: new Request("http://127.0.0.1:8788/owner/store-status.html")
  });
  assert.equal(ownerPageResponse.status, 200);
  const setCookie = ownerPageResponse.headers.get("set-cookie") || "";
  assert.match(setCookie, /trg_owner_csrf=/);
  assert.doesNotMatch(setCookie, /; Secure/i, "Loopback cookies must work over the local HTTP development server.");

  const csrfCookie = readSetCookie(setCookie, "trg_owner_csrf");
  assert.ok(csrfCookie, "Local Owner page should receive a CSRF cookie.");
  const mutationState = await mutationAuth.verifyAuthenticatedOwnerMutationRequest(
    new Request("http://127.0.0.1:8788/owner/api/store-status", {
      method: "POST",
      headers: {
        cookie: `trg_owner_csrf=${csrfCookie}`,
        origin: "http://127.0.0.1:8788",
        "x-csrf-token": csrfCookie
      }
    }),
    env
  );
  assert.equal(mutationState.valid, true, "Loopback Owner controls should retain CSRF protection.");
  assert.equal(mutationState.username, "rv-local-owner");
  assert.equal(await publicBypass.isAuthenticatedOwnerRequest(new Request("http://127.0.0.1:8788/store/"), env), true);

  const publicResponse = await middleware.handleOwnerMiddleware({
    env,
    next: () => new Response("unsafe"),
    request: new Request("https://tobacco-road-games-staging.pages.dev/owner/")
  });
  assert.equal(publicResponse.status, 503, "The local flag must never open a public hostname.");

  console.log("Loopback-only Owner access tests passed.");
}

function verifyLocalWorkbenchConfiguration() {
  const template = fs.readFileSync(path.join(ROOT, "ops/staging/wrangler.local-owner.toml"), "utf8");
  const deployConfiguration = fs.readFileSync(path.join(ROOT, "ops/staging/wrangler.pages.toml"), "utf8");
  const launcher = fs.readFileSync(path.join(ROOT, "ops/staging/start-local-owner.ps1"), "utf8");

  assert.match(template, /LOCAL_OWNER_BYPASS\s*=\s*"1"/);
  assert.match(template, /database_name\s*=\s*"trg-orders-staging"/);
  assert.match(template, /bucket_name\s*=\s*"trg-products-staging"/);
  assert.match(template, /remote\s*=\s*true/);
  assert.doesNotMatch(template, /OWNER_CSRF_SECRET/);
  assert.doesNotMatch(deployConfiguration, /LOCAL_OWNER_BYPASS/);
  assert.doesNotMatch(deployConfiguration, /OWNER_CSRF_SECRET/);
  assert.match(launcher, /--ip 127\.0\.0\.1/);
  assert.match(launcher, /RandomNumberGenerator/);
  assert.match(launcher, /branch --show-current/);
}

function readSetCookie(header, name) {
  const match = String(header).match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? match[1] : "";
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href + `?test=${Date.now()}-${Math.random()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
