const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const FileCtor = globalThis.File || require("node:buffer").File;

async function main() {
  const ownerAuth = await importModule("functions/_lib/owner-auth.mjs");
  const ownerLogin = await importModule("functions/_lib/owner-login.mjs");
  const ownerMiddleware = await importModule("functions/_lib/owner-middleware.mjs");
  const ownerPublish = await importModule("functions/_lib/owner-publish.mjs");
  const publishScript = require(path.join(ROOT, "scripts", "publish-intake.js"));
  const accessContext = await createAccessTestContext();

  try {
    const passwordHash = await ownerAuth.createPasswordHash("correct horse battery staple");
    assert.equal(await ownerAuth.verifyPasswordHash("correct horse battery staple", passwordHash), true, "Generated password hash should validate the correct password.");
    assert.equal(await ownerAuth.verifyPasswordHash("wrong password", passwordHash), false, "Generated password hash should reject the wrong password.");
    const baseEnv = {
      GITHUB_PUBLISH_REF: "owner-intake-test",
      GITHUB_REPO_NAME: "Tobacco-Road-Games",
      GITHUB_REPO_OWNER: "RVSwebmaster",
      GITHUB_TOKEN: "test-token",
      OWNER_CSRF_SECRET: "csrf-secret",
      OWNER_PASSWORD_HASH: passwordHash,
      OWNER_SESSION_SECRET: "session-secret",
      OWNER_USERNAME: "rv-owner"
    };
    const accessEnv = {
      ...baseEnv,
      OWNER_ACCESS_AUD: accessContext.audience,
      OWNER_ACCESS_EMAIL: accessContext.email,
      OWNER_ACCESS_TEAM_DOMAIN: accessContext.teamDomain
    };

    await testWrongUsername(ownerLogin, baseEnv);
    await testBadLogin(ownerLogin, baseEnv);
    const authCookies = await testGoodLogin(ownerLogin, baseEnv);
    await testMalformedHash(ownerLogin, baseEnv);
    await testMissingSecret(ownerLogin, baseEnv);
    await testUnexpectedLoginException(ownerLogin, baseEnv);
    await testAlteredCookie(ownerMiddleware, baseEnv, authCookies);
    await testExpiredCookie(ownerMiddleware, ownerAuth, baseEnv);
    await testOwnerIntakeAliasRedirects(ownerMiddleware, baseEnv, authCookies);
    await testMissingFiles(ownerPublish, baseEnv, authCookies);
    await testWrongFileType(ownerPublish, baseEnv, authCookies);
    await testR2UploadAndGithubDispatch(ownerPublish, baseEnv, authCookies);
    await testAccessLoginRedirect(ownerLogin, accessEnv, accessContext.token);
    const accessCookies = await testAccessMiddlewareAllowsAuthorized(ownerMiddleware, accessEnv, accessContext.token);
    await testAccessMiddlewareDeniesUnauthorized(ownerMiddleware, accessEnv);
    await testAccessPublishDeniedUnauthorized(ownerPublish, accessEnv);
    await testAccessPublishAccepted(ownerPublish, accessEnv, accessContext.token, accessCookies);
    await testExistingProductUpdatePreservesFields(publishScript);
    await testNewProductBuildAndSharedMap(publishScript);

    console.log("Owner intake tests passed.");
  } finally {
    await closeAccessTestContext(accessContext);
  }
}

async function testWrongUsername(ownerLogin, env) {
  const formData = new FormData();
  formData.set("username", "not-the-owner");
  formData.set("password", "correct horse battery staple");

  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login", {
    body: formData,
    method: "POST"
  }), env);

  assert.equal(response.status, 401, "Wrong username should return 401.");
  const body = await response.text();
  assert.match(body, /did not work/i, "Wrong username should show a human-readable error.");
}

async function testBadLogin(ownerLogin, env) {
  const formData = new FormData();
  formData.set("username", env.OWNER_USERNAME);
  formData.set("password", "wrong password");

  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login", {
    body: formData,
    method: "POST"
  }), env);

  assert.equal(response.status, 401, "Bad login should return 401.");
  const body = await response.text();
  assert.match(body, /did not work/i, "Bad login should show a human-readable error.");
}

async function testGoodLogin(ownerLogin, env) {
  const formData = new FormData();
  formData.set("username", env.OWNER_USERNAME);
  formData.set("password", "correct horse battery staple");

  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login?next=%2Fowner%2Fproduct-intake.html", {
    body: formData,
    method: "POST"
  }), env);

  assert.equal(response.status, 303, "Good login should redirect.");
  const cookies = extractSetCookies(response.headers);
  assert.equal(cookies.length, 2, "Good login should set session and CSRF cookies.");
  assert.ok(cookies.some((cookie) => cookie.includes("trg_owner_session=") && cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict")), "Session cookie should be secure and HttpOnly.");
  assert.ok(cookies.some((cookie) => cookie.includes("trg_owner_csrf=") && cookie.includes("SameSite=Strict")), "CSRF cookie should be secure and strict.");
  return cookieHeaderFromSetCookies(cookies);
}

async function testMalformedHash(ownerLogin, env) {
  const formData = new FormData();
  formData.set("username", env.OWNER_USERNAME);
  formData.set("password", "wrong password");

  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login", {
    body: formData,
    method: "POST"
  }), {
    ...env,
    OWNER_PASSWORD_HASH: "pbkdf2_sha256$310000$bad***$also***"
  });

  assert.equal(response.status, 503, "Malformed password hash should return 503 instead of throwing.");
  const body = await response.text();
  assert.match(body, /OWNER_PASSWORD_HASH|not configured correctly/i, "Malformed password hash should show a configuration error.");
}

async function testMissingSecret(ownerLogin, env) {
  const formData = new FormData();
  formData.set("username", env.OWNER_USERNAME);
  formData.set("password", "wrong password");

  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login", {
    body: formData,
    method: "POST"
  }), {
    ...env,
    OWNER_SESSION_SECRET: ""
  });

  assert.equal(response.status, 503, "Missing owner secrets should return 503.");
  const body = await response.text();
  assert.match(body, /not configured yet/i, "Missing owner secrets should show a configuration error.");
}

async function testUnexpectedLoginException(ownerLogin, env) {
  const captured = [];
  const originalConsoleError = console.error;
  console.error = (entry) => {
    captured.push(String(entry));
  };

  try {
    const response = await ownerLogin.handleOwnerLoginRequest({
      formData() {
        throw new Error("synthetic login failure");
      },
      headers: new Headers({
        "cf-ray": "test-ray-id"
      }),
      method: "POST",
      url: "https://example.com/owner/login"
    }, env);

    assert.equal(response.status, 500, "Unexpected login exceptions should be caught and turned into a normal response.");
    const body = await response.text();
    assert.match(body, /could not be completed/i, "Unexpected login exceptions should show a safe error.");
    assert.equal(captured.length, 1, "Unexpected login exceptions should be logged once.");
    assert.match(captured[0], /owner_login_exception/, "Unexpected login exceptions should use the safe event log.");
    assert.doesNotMatch(captured[0], /correct horse battery staple|session-secret|csrf-secret|pbkdf2_sha256/, "Safe login logs must not include secrets or credentials.");
  } finally {
    console.error = originalConsoleError;
  }
}

async function testAccessLoginRedirect(ownerLogin, env, accessToken) {
  const response = await ownerLogin.handleOwnerLoginRequest(new Request("https://example.com/owner/login?next=%2Fowner%2Fproduct-intake.html", {
    headers: {
      "cf-access-jwt-assertion": accessToken
    },
    method: "GET"
  }), env);

  assert.equal(response.status, 303, "Access-protected login should redirect into the intake page.");
  assert.match(response.headers.get("location") || "", /\/owner\/product-intake\.html$/, "Access-protected login should redirect to the owner intake.");
}

async function testAlteredCookie(ownerMiddleware, env, cookieHeader) {
  const tamperedCookie = cookieHeader.replace(/trg_owner_session=([^;]+)/, "trg_owner_session=$1tampered");
  const response = await ownerMiddleware.handleOwnerMiddleware({
    env,
    next: () => new Response("ok"),
    request: new Request("https://example.com/owner/product-intake.html", {
      headers: {
        cookie: tamperedCookie
      }
    })
  });

  assert.equal(response.status, 303, "Altered owner page cookie should redirect to login.");
  assert.match(response.headers.get("location") || "", /\/owner\/login/, "Altered cookie redirect should go to login.");
}

async function testExpiredCookie(ownerMiddleware, ownerAuth, env) {
  const expiredSession = await ownerAuth.createSessionToken(env.OWNER_USERNAME, env.OWNER_SESSION_SECRET, Date.now() - 9 * 60 * 60 * 1000);
  const response = await ownerMiddleware.handleOwnerMiddleware({
    env,
    next: () => new Response("ok"),
    request: new Request("https://example.com/owner/product-intake.html", {
      headers: {
        cookie: `trg_owner_session=${expiredSession}`
      }
    })
  });

  assert.equal(response.status, 303, "Expired cookie should redirect to login.");
  assert.match(response.headers.get("location") || "", /\/owner\/login/, "Expired cookie redirect should go to login.");
}

async function testOwnerIntakeAliasRedirects(ownerMiddleware, env, cookieHeader) {
  const response = await ownerMiddleware.handleOwnerMiddleware({
    env,
    next: () => new Response("ok"),
    request: new Request("https://example.com/owner/intake", {
      headers: {
        cookie: cookieHeader
      }
    })
  });

  assert.equal(response.status, 303, "Owner intake alias should redirect.");
  assert.match(response.headers.get("location") || "", /\/owner\/product-intake\.html$/, "Owner intake alias should land on the real intake page.");
}

async function testAccessMiddlewareAllowsAuthorized(ownerMiddleware, env, accessToken) {
  const response = await ownerMiddleware.handleOwnerMiddleware({
    env,
    next: () => new Response("ok", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      },
      status: 200
    }),
    request: new Request("https://example.com/owner/product-intake.html", {
      headers: {
        "cf-access-jwt-assertion": accessToken
      }
    })
  });

  assert.equal(response.status, 200, "Authorized Access request should reach the owner page.");
  const cookies = extractSetCookies(response.headers);
  assert.ok(cookies.some((cookie) => cookie.includes("trg_owner_csrf=") && cookie.includes("SameSite=Strict")), "Authorized Access request should issue the CSRF cookie.");
  return cookieHeaderFromSetCookies(cookies);
}

async function testAccessMiddlewareDeniesUnauthorized(ownerMiddleware, env) {
  const response = await ownerMiddleware.handleOwnerMiddleware({
    env,
    next: () => new Response("ok"),
    request: new Request("https://example.com/owner/product-intake.html")
  });

  assert.equal(response.status, 403, "Missing Access JWT should deny the owner page.");
  const body = await response.text();
  assert.match(body, /Cloudflare Access/i, "Missing Access JWT should explain that Cloudflare Access is required.");
}

async function testMissingFiles(ownerPublish, env, cookieHeader) {
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.webp", { type: "image/webp" }));

  const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 400, "Missing files should return 400.");
  const payload = await response.json();
  assert.match(payload.error, /product\.pdf is required/i, "Missing PDF error should be human-readable.");
}

async function testAccessPublishDeniedUnauthorized(ownerPublish, env) {
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "product.pdf", { type: "application/pdf" }));

  const response = await ownerPublish.handleOwnerPublishRequest(new Request("https://example.com/owner/api/publish", {
    body: formData,
    headers: {
      origin: "https://example.com"
    },
    method: "POST"
  }), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 403, "Publish should deny direct unauthenticated requests in Access mode.");
  const payload = await response.json();
  assert.match(payload.error, /Cloudflare Access/i, "Access-mode publish denial should mention Cloudflare Access.");
}

async function testWrongFileType(ownerPublish, env, cookieHeader) {
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.png", { type: "image/png" }));
  formData.set("productFile", new FileCtor(["pdf"], "product.pdf", { type: "application/pdf" }));

  const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 400, "Wrong file type should return 400.");
  const payload = await response.json();
  assert.match(payload.error, /preview\.webp must be uploaded with that exact filename|must be a WebP/i, "Wrong file type error should be human-readable.");
}

async function testAccessPublishAccepted(ownerPublish, env, accessToken, cookieHeader) {
  const bucket = createMockBucket();
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "product.pdf", { type: "application/pdf" }));

  const originalRandomUuid = crypto.randomUUID;
  const originalDateNow = Date.now;
  const fixedNow = 1760000000001;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/dispatches")) {
      return new Response(null, { status: 204 });
    }

    return jsonResponse({
      workflow_runs: [
        {
          conclusion: "success",
          created_at: new Date().toISOString(),
          display_title: `Owner publish pub-${fixedNow}-access-run`,
          html_url: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/2",
          id: 2,
          status: "completed"
        }
      ]
    });
  };

  Date.now = () => fixedNow;
  crypto.randomUUID = () => "access-run";
  try {
    const response = await ownerPublish.handleOwnerPublishRequest(buildAccessAuthenticatedPublishRequest(formData, cookieHeader, accessToken), {
      ...env,
      TRG_PRODUCTS: bucket
    }, {
      dispatchOptions: {
        fetchImpl,
        pollIntervalMs: 1,
        timeoutMs: 100
      }
    });

    assert.equal(response.status, 200, "Authenticated Access publish should succeed.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Authenticated Access publish should report success.");
    assert.deepEqual(bucket.putKeys.sort(), [
      "new-product/cover.webp",
      "new-product/preview.webp",
      "new-product/product.pdf"
    ], "Authenticated Access publish should upload all required files.");
  } finally {
    Date.now = originalDateNow;
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testR2UploadAndGithubDispatch(ownerPublish, env, cookieHeader) {
  const bucket = createMockBucket();
  const calls = [];
  const fixedNow = 1760000000000;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/dispatches")) {
      const body = JSON.parse(options.body);
      assert.equal(body.client_payload.ref, env.GITHUB_PUBLISH_REF, "Dispatch should use the configured ref.");
      return new Response(null, { status: 204 });
    }

    return jsonResponse({
      workflow_runs: [
        {
          conclusion: "success",
          created_at: new Date().toISOString(),
          display_title: `Owner publish pub-${fixedNow}-test-run`,
          html_url: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/1",
          id: 1,
          status: "completed"
        }
      ]
    });
  };

  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "product.pdf", { type: "application/pdf" }));

  const originalRandomUuid = crypto.randomUUID;
  const originalDateNow = Date.now;
  Date.now = () => fixedNow;
  crypto.randomUUID = () => "test-run";
  try {
    const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
      ...env,
      TRG_PRODUCTS: bucket
    }, {
      dispatchOptions: {
        fetchImpl,
        pollIntervalMs: 1,
        timeoutMs: 100
      }
    });

    assert.equal(response.status, 200, "Successful publish should return 200.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Successful publish should report success.");
    assert.deepEqual(bucket.putKeys.sort(), [
      "new-product/cover.webp",
      "new-product/preview.webp",
      "new-product/product.pdf"
    ], "R2 upload should write all required files.");
    assert.ok(calls.some((call) => String(call.url).includes("/dispatches")), "GitHub dispatch should be called after upload.");
  } finally {
    Date.now = originalDateNow;
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testExistingProductUpdatePreservesFields(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  const tempProductsPath = path.join(tempRoot, "data", "products.json");
  const tempProducts = JSON.parse(fs.readFileSync(tempProductsPath, "utf8"));
  tempProducts[0].saleEnabled = true;
  tempProducts[0].saleLabel = "Summer Sale";
  tempProducts[0].bundleEligible = true;
  fs.writeFileSync(tempProductsPath, `${JSON.stringify(tempProducts, null, 2)}\n`);

  await publishScript.applyPublishPayload(tempRoot, {
    folder: "sirrocans",
    metadata: {
      buyMode: "preview-only",
      gameSystem: "5E Compatible",
      gameSystemSlug: "5e-compatible",
      longDescription: "Updated long copy.",
      productLine: "Fifth Edition Fantasy Roleplaying",
      productLineSlug: "fifth-edition-fantasy-roleplaying",
      shortDescription: "Updated short copy.",
      slug: "sirrocans",
      status: "preview-available",
      subtitle: "Updated subtitle",
      title: "Sirrocans",
      version: "2026 release file"
    }
  });

  const updatedProducts = JSON.parse(fs.readFileSync(tempProductsPath, "utf8"));
  const sirrocans = updatedProducts.find((product) => product.slug === "sirrocans");
  assert.equal(sirrocans.saleEnabled, true, "Existing sale flags should survive publish.");
  assert.equal(sirrocans.saleLabel, "Summer Sale", "Existing sale labels should survive publish.");
  assert.equal(sirrocans.bundleEligible, true, "Existing bundle flags should survive publish.");
  assert.equal(sirrocans.shortDescription, "Updated short copy.", "Explicit new copy should apply.");
}

async function testNewProductBuildAndSharedMap(publishScript) {
  const tempRoot = createTempRepo([
    "data/authors.js",
    "data/product-intake-map.json",
    "data/products.json",
    "scripts/build-store.js",
    "shared/product-folder-map.mjs"
  ]);

  await publishScript.applyPublishPayload(tempRoot, {
    folder: "ghost-cairn",
    metadata: {
      buyMode: "preview-only",
      gameSystem: "System Neutral",
      gameSystemSlug: "system-neutral",
      longDescription: "A test-only haunted cairn product.",
      productLine: "Other Games & Experiments",
      productLineSlug: "other-games-and-experiments",
      releaseDate: "2026-06-22",
      series: "Tablecraft",
      seriesSlug: "tablecraft",
      shortDescription: "A test-only haunted cairn product.",
      slug: "ghost-cairn",
      status: "preview-available",
      subtitle: "A test-only haunted cairn preview",
      tags: ["Preview", "Test"],
      title: "Ghost Cairn",
      version: "test"
    }
  });

  const build = spawnSync(process.execPath, [path.join(tempRoot, "scripts", "build-store.js")], {
    cwd: tempRoot,
    encoding: "utf8"
  });
  assert.equal(build.status, 0, `Build should succeed for a new product. ${build.stderr || build.stdout}`);

  const builtPagePath = path.join(tempRoot, "store", "products", "ghost-cairn", "index.html");
  assert.ok(fs.existsSync(builtPagePath), "New product page should be generated.");
  const builtPage = fs.readFileSync(builtPagePath, "utf8");
  assert.match(builtPage, /\/product-assets\/ghost-cairn\/cover\.webp/, "New product page should use the public cover route.");
  assert.match(builtPage, /\/product-assets\/ghost-cairn\/preview\.webp/, "New product page should use the public preview route.");

  const builtSeriesPath = path.join(tempRoot, "store", "series", "tablecraft", "index.html");
  assert.ok(fs.existsSync(builtSeriesPath), "Series landing page should be generated when a product includes a series.");

  const sharedMap = await import(`${pathToFileURL(path.join(tempRoot, "shared", "product-folder-map.mjs")).href}?cacheBust=${Date.now()}`);
  assert.equal(sharedMap.getFolderForSlug("ghost-cairn"), "ghost-cairn", "Shared folder map should know the new product folder.");
}

function addRequiredTextFields(formData) {
  formData.set("title", "New Product");
  formData.set("slug", "new-product");
  formData.set("folder", "new-product");
  formData.set("subtitle", "A test product");
  formData.set("gameSystem", "System Neutral");
  formData.set("gameSystemSlug", "system-neutral");
  formData.set("productLine", "Other Games & Experiments");
  formData.set("productLineSlug", "other-games-and-experiments");
  formData.set("series", "Tablecraft");
  formData.set("seriesSlug", "tablecraft");
  formData.set("format", "PDF");
  formData.set("status", "preview-available");
  formData.set("buyMode", "preview-only");
  formData.set("shortDescription", "Short description");
  formData.set("longDescription", "Long description");
  formData.set("version", "1.0");
}

function buildAuthenticatedPublishRequest(formData, cookieHeader) {
  const csrfToken = readCookieFromHeader(cookieHeader, "trg_owner_csrf");
  return new Request("https://example.com/owner/api/publish", {
    body: formData,
    headers: {
      cookie: cookieHeader,
      origin: "https://example.com",
      "x-csrf-token": csrfToken
    },
    method: "POST"
  });
}

function buildAccessAuthenticatedPublishRequest(formData, cookieHeader, accessToken) {
  const csrfToken = readCookieFromHeader(cookieHeader, "trg_owner_csrf");
  return new Request("https://example.com/owner/api/publish", {
    body: formData,
    headers: {
      "cf-access-jwt-assertion": accessToken,
      cookie: cookieHeader,
      origin: "https://example.com",
      "x-csrf-token": csrfToken
    },
    method: "POST"
  });
}

function createMockBucket() {
  return {
    deletedKeys: [],
    putKeys: [],
    async delete(key) {
      this.deletedKeys.push(key);
    },
    async put(key) {
      this.putKeys.push(key);
    }
  };
}

function createTempRepo(relativePaths) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trg-owner-intake-"));
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(ROOT, relativePath);
    const destinationPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return tempRoot;
}

function cookieHeaderFromSetCookies(setCookies) {
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : [];
}

function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    status: 200
  });
}

function readCookieFromHeader(cookieHeader, name) {
  const cookies = String(cookieHeader || "").split(";").map((entry) => entry.trim());
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const cookieName = cookie.slice(0, separator);
    if (cookieName === name) {
      return cookie.slice(separator + 1);
    }
  }
  return "";
}

async function createAccessTestContext() {
  const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "owner-access-test";
  publicJwk.use = "sig";

  const server = http.createServer((request, response) => {
    if (request.url === "/cdn-cgi/access/certs") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({
        keys: [publicJwk]
      }));
      return;
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const teamDomain = `http://127.0.0.1:${address.port}`;
  const audience = "owner-access-test-audience";
  const email = "rv@example.com";
  const token = await new SignJWT({
    email
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: publicJwk.kid
    })
    .setAudience(audience)
    .setExpirationTime("2h")
    .setIssuedAt()
    .setIssuer(teamDomain)
    .setSubject("rv-owner-subject")
    .sign(privateKey);

  return {
    audience,
    email,
    server,
    teamDomain,
    token
  };
}

async function closeAccessTestContext(accessContext) {
  if (!accessContext?.server) {
    return;
  }

  await new Promise((resolve, reject) => {
    accessContext.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
