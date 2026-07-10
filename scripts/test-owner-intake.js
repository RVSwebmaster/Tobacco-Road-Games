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
  const ownerPricing = await importModule("functions/_lib/owner-pricing-publish.mjs");
  const productAdvisor = require(path.join(ROOT, "shared", "product-advisor.js"));
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
    await testCartPublishAcceptedWithoutBuyUrl(ownerPublish, baseEnv, authCookies);
    await testCartPublishRejectsMissingPrice(ownerPublish, baseEnv, authCookies);
    await testCartPublishRejectsInvalidStatus(ownerPublish, baseEnv, authCookies);
    await testExistingProductMetadataOnlyPublish(ownerPublish, baseEnv, authCookies);
    await testOwnerPricingPublishAccepted(ownerPricing, baseEnv, authCookies);
    await testOwnerPricingPublishRejectsInvalidPayload(ownerPricing, baseEnv, authCookies);
    await testR2UploadAndGithubDispatch(ownerPublish, baseEnv, authCookies);
    await testExistingListingPublishAcceptedWhileWorkflowContinues(ownerPublish, baseEnv, authCookies);
    await testPublishReturnsJsonWhenGithubDispatchThrows(ownerPublish, baseEnv, authCookies);
    await testUnexpectedPublishExceptionHandled(ownerPublish, baseEnv, authCookies);
    await testAccessLoginRedirect(ownerLogin, accessEnv, accessContext.token);
    const accessCookies = await testAccessMiddlewareAllowsAuthorized(ownerMiddleware, accessEnv, accessContext.token);
    await testAccessMiddlewareDeniesUnauthorized(ownerMiddleware, accessEnv);
    await testAccessPublishDeniedUnauthorized(ownerPublish, accessEnv);
    await testAccessPublishAccepted(ownerPublish, accessEnv, accessContext.token, accessCookies);
    await testProductAdvisorSuggestions(productAdvisor);
    await testExistingProductUpdatePreservesFields(publishScript);
    await testExistingProductUpdateKeepsUneditedSlugMetadata(publishScript);
    await testPricingUpdatePreservesUnrelatedFields(publishScript);
    await testPricingUpdateRejectsInvalidMoney(publishScript);
    await testPricingUpdateRejectsSaleAboveRegular(publishScript);
    await testPricingUpdateRejectsInvalidDates(publishScript);
    await testPricingUpdateRequiresConfirmationForNonPaidSaleFields(publishScript);
    await testPricingUpdateBuildConsistency(publishScript);
    await testPublishScriptRejectsInvalidCartMetadata(publishScript);
    await testPublishScriptNormalizesCartBuyUrl(publishScript);
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
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));

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
  assert.match(payload.error, /product pdf is required/i, "Missing PDF error should be human-readable.");
}

async function testAccessPublishDeniedUnauthorized(ownerPublish, env) {
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

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
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "preview.png", { type: "image/png" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

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
  assert.match(payload.error, /preview image must be a webp image/i, "Wrong file type error should be human-readable.");
}

async function testCartPublishAcceptedWithoutBuyUrl(ownerPublish, env, cookieHeader) {
  const bucket = createMockBucket();
  const formData = new FormData();
  addRequiredTextFields(formData, {
    buyMode: "cart",
    price: "4.99",
    status: "available-direct"
  });
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

  const originalRandomUuid = crypto.randomUUID;
  const originalDateNow = Date.now;
  const fixedNow = 1760000000003;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/dispatches")) {
      return new Response(null, { status: 204 });
    }

    return jsonResponse({
      workflow_runs: [
        {
          conclusion: "success",
          created_at: new Date().toISOString(),
          display_title: `Owner publish pub-${fixedNow}-cart-mode`,
          html_url: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/4",
          id: 4,
          status: "completed"
        }
      ]
    });
  };

  Date.now = () => fixedNow;
  crypto.randomUUID = () => "cart-mode";
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

    assert.equal(response.status, 200, "Cart products should publish without a buy URL.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Cart publish should report success.");
  } finally {
    Date.now = originalDateNow;
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testCartPublishRejectsMissingPrice(ownerPublish, env, cookieHeader) {
  const formData = new FormData();
  addRequiredTextFields(formData, {
    buyMode: "cart",
    price: "",
    status: "available-direct"
  });
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

  const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 400, "Cart products without a price should be rejected.");
  const payload = await response.json();
  assert.match(payload.error, /Cart products require a positive price/i, "Cart price validation should be human-readable.");
}

async function testCartPublishRejectsInvalidStatus(ownerPublish, env, cookieHeader) {
  const formData = new FormData();
  addRequiredTextFields(formData, {
    buyMode: "cart",
    price: "4.99",
    status: "coming-soon"
  });
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

  const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 400, "Cart products with the wrong status should be rejected.");
  const payload = await response.json();
  assert.match(payload.error, /Cart products must use Available Direct status/i, "Cart status validation should be human-readable.");
}

async function testExistingProductMetadataOnlyPublish(ownerPublish, env, cookieHeader) {
  const bucket = createMockBucket();
  const calls = [];
  const fixedNow = 1760000000002;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/dispatches")) {
      return new Response(null, { status: 204 });
    }

    return jsonResponse({
      workflow_runs: [
        {
          conclusion: "success",
          created_at: new Date().toISOString(),
          display_title: `Owner publish pub-${fixedNow}-metadata-only`,
          html_url: "https://github.com/RVSwebmaster/Tobacco-Road-Games/actions/runs/3",
          id: 3,
          status: "completed"
        }
      ]
    });
  };

  const formData = new FormData();
  addRequiredTextFields(formData, {
    folder: "sirrocans",
    gameSystem: "5E Compatible",
    gameSystemSlug: "5e-compatible",
    longDescription: "Metadata-only update for an existing listing.",
    productLine: "Fifth Edition Fantasy Roleplaying",
    productLineSlug: "fifth-edition-fantasy-roleplaying",
    series: "",
    seriesSlug: "",
    shortDescription: "Metadata-only update for an existing listing.",
    slug: "sirrocans",
    subtitle: "Updated existing product",
    title: "Sirrocans"
  });

  const originalRandomUuid = crypto.randomUUID;
  const originalDateNow = Date.now;
  Date.now = () => fixedNow;
  crypto.randomUUID = () => "metadata-only";
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

    assert.equal(response.status, 200, "Existing listings should allow metadata-only publish.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Metadata-only publish should still report success.");
    assert.deepEqual(bucket.putKeys, [], "Metadata-only publish should not overwrite assets when no replacement files were provided.");
    assert.ok(calls.some((call) => String(call.url).includes("/dispatches")), "Metadata-only publish should still dispatch the GitHub workflow.");
  } finally {
    Date.now = originalDateNow;
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testOwnerPricingPublishAccepted(ownerPricing, env, cookieHeader) {
  const calls = [];
  const fixedNow = 1760000000004;
  const originalDateNow = Date.now;
  const originalRandomUuid = crypto.randomUUID;
  Date.now = () => fixedNow;
  crypto.randomUUID = () => "pricing-publish-uuid";

  try {
    const response = await ownerPricing.handleOwnerPricingPublishRequest(buildAuthenticatedPricingRequest({
      currency: "USD",
      nonPurchasableSaleConfirmed: true,
      price: "4.99",
      priceCents: 499,
      saleEnabled: true,
      saleEnd: "2026-07-31",
      saleLabel: "Launch Sale",
      salePrice: "3.99",
      salePriceCents: 399,
      saleStart: "2026-07-01",
      slug: "sirrocans"
    }, cookieHeader), env, {
      dispatchOptions: {
        fetchImpl: async (url, options = {}) => {
          calls.push({ url: String(url), options });
          if (String(url).endsWith("/dispatches")) {
            return new Response(null, { status: 204 });
          }
          return jsonResponse({
            workflow_runs: [
              {
                conclusion: "success",
                created_at: "2025-10-09T08:53:20.000Z",
                display_title: "Owner publish price-1760000000004-pricing-publish-uuid",
                html_url: "https://example.com/run",
                id: 1,
                status: "completed"
              }
            ]
          });
        },
        pollIntervalMs: 1,
        timeoutMs: 25
      }
    });

    assert.equal(response.status, 200, "Authenticated pricing updates should publish successfully.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Successful pricing updates should return ok.");
    const dispatchCall = calls.find((call) => call.url.endsWith("/dispatches"));
    assert.ok(dispatchCall, "Pricing updates should dispatch the GitHub publish workflow.");
    const dispatchPayload = JSON.parse(dispatchCall.options.body);
    assert.equal(dispatchPayload.client_payload.operation, "pricing_update", "Pricing updates should use a dedicated workflow operation.");
    assert.equal(dispatchPayload.client_payload.metadata.slug, "sirrocans", "Pricing updates should dispatch the target product slug.");
    assert.equal(dispatchPayload.client_payload.metadata.priceCents, 499, "Pricing updates should dispatch derived price cents.");
  } finally {
    Date.now = originalDateNow;
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testOwnerPricingPublishRejectsInvalidPayload(ownerPricing, env, cookieHeader) {
  const response = await ownerPricing.handleOwnerPricingPublishRequest(buildAuthenticatedPricingRequest({
    currency: "USD",
    price: "4.999",
    priceCents: 500,
    saleEnabled: false,
    saleEnd: "",
    saleLabel: "",
    salePrice: "",
    salePriceCents: null,
    saleStart: "",
    slug: "sirrocans"
  }, cookieHeader), env, {
    dispatchOptions: {
      fetchImpl: async () => new Response(null, { status: 204 })
    }
  });

  assert.equal(response.status, 400, "Invalid pricing payloads should be rejected before GitHub dispatch.");
  const payload = await response.json();
  assert.match(payload.error, /valid dollar amount|must match/i, "Pricing validation failures should be human-readable.");
}

async function testAccessPublishAccepted(ownerPublish, env, accessToken, cookieHeader) {
  const bucket = createMockBucket();
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

  const originalRandomUuid = crypto.randomUUID;
  const originalDateNow = Date.now;
  const fixedNow = 1760000000001;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/dispatches")) {
      return new Response(null, { status: 204 });
    }

    const workflowRunsUrl = new URL(String(url));
    assert.equal(workflowRunsUrl.searchParams.get("event"), "repository_dispatch", "Workflow polling should filter by the GitHub event name.");

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

    const workflowRunsUrl = new URL(String(url));
    assert.equal(workflowRunsUrl.searchParams.get("event"), "repository_dispatch", "Workflow polling should filter by the GitHub event name.");

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
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

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

async function testExistingListingPublishAcceptedWhileWorkflowContinues(ownerPublish, env, cookieHeader) {
  const bucket = createMockBucket();
  const formData = new FormData();
  addRequiredTextFields(formData, {
    folder: "sirrocans",
    gameSystem: "5E Compatible",
    gameSystemSlug: "5e-compatible",
    longDescription: "Pending workflow metadata-only update.",
    productLine: "Fifth Edition Fantasy Roleplaying",
    productLineSlug: "fifth-edition-fantasy-roleplaying",
    series: "",
    seriesSlug: "",
    shortDescription: "Pending workflow metadata-only update.",
    slug: "sirrocans",
    subtitle: "Pending workflow subtitle",
    title: "Sirrocans"
  });

  const originalRandomUuid = crypto.randomUUID;
  crypto.randomUUID = () => "pending-workflow";
  try {
    const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
      ...env,
      TRG_PRODUCTS: bucket
    }, {
      dispatchOptions: {
        fetchImpl: async (url) => {
          if (String(url).endsWith("/dispatches")) {
            return new Response(null, { status: 204 });
          }

          return jsonResponse({
            workflow_runs: []
          });
        },
        pollIntervalMs: 1,
        timeoutMs: 5
      }
    });

    assert.equal(response.status, 202, "Publish should return 202 when GitHub accepted the request but the workflow is still running.");
    const payload = await response.json();
    assert.equal(payload.ok, true, "Pending publish should still use a successful JSON envelope.");
    assert.equal(payload.pending, true, "Pending publish should tell the client the workflow is still running.");
    assert.deepEqual(bucket.putKeys, [], "Metadata-only pending publish should not upload replacement assets.");
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

async function testPublishReturnsJsonWhenGithubDispatchThrows(ownerPublish, env, cookieHeader) {
  const formData = new FormData();
  addRequiredTextFields(formData);
  formData.set("coverFile", new FileCtor(["cover"], "agency-cover.webp", { type: "image/webp" }));
  formData.set("previewFile", new FileCtor(["preview"], "agency-preview.webp", { type: "image/webp" }));
  formData.set("productFile", new FileCtor(["pdf"], "Agency.pdf", { type: "application/pdf" }));

  const response = await ownerPublish.handleOwnerPublishRequest(buildAuthenticatedPublishRequest(formData, cookieHeader), {
    ...env,
    TRG_PRODUCTS: createMockBucket()
  }, {
    dispatchOptions: {
      fetchImpl: async () => {
        throw new Error("synthetic github outage");
      }
    }
  });

  assert.equal(response.status, 502, "GitHub dispatch failures should return a structured 502 instead of throwing.");
  const payload = await response.json();
  assert.match(payload.error, /could not be reached from Cloudflare/i, "GitHub dispatch failures should surface a safe, actionable message.");
}

async function testUnexpectedPublishExceptionHandled(ownerPublish, env, cookieHeader) {
  const originalConsoleError = console.error;
  const captured = [];
  console.error = (entry) => {
    captured.push(String(entry));
  };

  try {
    const response = await ownerPublish.handleOwnerPublishRequest({
      formData() {
        throw new Error("synthetic publish failure");
      },
      headers: new Headers({
        "cf-ray": "publish-test-ray",
        cookie: cookieHeader,
        origin: "https://example.com",
        "x-csrf-token": readCookieFromHeader(cookieHeader, "trg_owner_csrf")
      }),
      method: "POST",
      url: "https://example.com/owner/api/publish"
    }, {
      ...env,
      TRG_PRODUCTS: createMockBucket()
    });

    assert.equal(response.status, 500, "Unexpected publish exceptions should be converted into a JSON 500 response.");
    assert.match(response.headers.get("content-type") || "", /application\/json/i, "Unexpected publish exceptions should return JSON.");
    const payload = await response.json();
    assert.match(payload.error, /could not be completed/i, "Unexpected publish exceptions should return a safe owner-facing message.");
    assert.equal(captured.length, 1, "Unexpected publish exceptions should be logged once.");
    assert.match(captured[0], /owner_publish_exception/, "Unexpected publish exceptions should use the safe publish event log.");
    assert.doesNotMatch(captured[0], /session-secret|csrf-secret|test-token|correct horse battery staple|pbkdf2_sha256/i, "Unexpected publish logs must not leak secrets.");
  } finally {
    console.error = originalConsoleError;
  }
}

async function testProductAdvisorSuggestions(productAdvisor) {
  const result = productAdvisor.analyzeProductListing({
    coverImage: "/product-assets/agency/cover.webp",
    features: [
      "A practical definition of player agency.",
      "Advice for creating meaningful choices and honest consequences.",
      "System-neutral guidance usable in virtually any tabletop RPG."
    ],
    fileList: ["Agency.pdf"],
    gameSystem: "System Agnotic",
    longDescription: "Agency: Share the Wheel or Crash the Game is a system-neutral tabletop roleplaying supplement about player choice, Game Master authority, and shared responsibility in campaign play.",
    page_count: 9,
    previewImage: "/product-assets/agency/preview.webp",
    productLine: "Tablecraft",
    series: "Tablecraft",
    short_description: "A practical system-neutral guide to player choice, consequence, and campaign design.",
    subtitle: "Share the wheel or crash the game",
    tags: ["Tablecraft"],
    title: "Agency"
  }, {
    catalog: [
      {
        productLine: "Tablecraft",
        series: "Tablecraft",
        slug: "tablecraft-primer",
        tags: ["Tablecraft", "GM Advice"],
        title: "Tablecraft Primer"
      },
      {
        productLine: "Fifth Edition Fantasy Roleplaying",
        series: "",
        slug: "sirrocans",
        tags: ["5E", "Ancestry"],
        title: "Sirrocans"
      }
    ]
  });

  assert.equal(result.suggested_price, 4.99, "Advisor should anchor short Tablecraft advice at a $4.99 MSRP.");
  assert.equal(result.suggested_sale_price, 2.99, "Advisor should suggest a lighter sale price tier.");
  assert.equal(result.product_type, "GM Advice", "Advisor should identify the GM advice format.");
  assert.equal(result.series_fit, "Tablecraft", "Advisor should detect the Tablecraft fit.");
  assert.ok(result.price_confidence >= 0.8, "Advisor confidence should be high for a well-described listing.");
  assert.ok(result.suggested_tags.includes("Agency"), "Advisor should include title-driven tags.");
  assert.ok(result.suggested_tags.includes("GM Advice"), "Advisor should include advice classification tags.");
  assert.ok(result.suggested_cross_sells.includes("tablecraft-primer"), "Advisor should suggest same-series cross-sells.");
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

async function testExistingProductUpdateKeepsUneditedSlugMetadata(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  const tempProductsPath = path.join(tempRoot, "data", "products.json");

  await publishScript.applyPublishPayload(tempRoot, {
    folder: "ringbound",
    metadata: {
      buyMode: "preview-only",
      gameSystem: "System TBD",
      gameSystemSlug: "system-tbd",
      longDescription: "Product summary coming soon.",
      pageCount: 12,
      productLine: "Other Games & Experiments",
      productLineSlug: "other-games-and-experiments",
      shortDescription: "Product summary coming soon.",
      slug: "ringbound",
      status: "preview-available",
      subtitle: "A Tobacco Road Games catalog preview",
      title: "Ringbound",
      version: "2026 catalog preview"
    }
  });

  const updatedProducts = JSON.parse(fs.readFileSync(tempProductsPath, "utf8"));
  const ringbound = updatedProducts.find((product) => product.slug === "ringbound");
  assert.equal(ringbound.productLineSlug, "other-games-and-experiments", "Existing metadata-only updates should preserve the original product-line slug when the visible label is unchanged.");
  assert.equal(Object.prototype.hasOwnProperty.call(ringbound, "series"), false, "Existing metadata-only updates should not invent empty series fields.");
  assert.equal(Object.prototype.hasOwnProperty.call(ringbound, "seriesSlug"), false, "Existing metadata-only updates should not invent empty series slug fields.");
  assert.equal(ringbound.pageCount, 12, "The requested page-count change should still apply.");
}

async function testPricingUpdatePreservesUnrelatedFields(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  const productsPath = path.join(tempRoot, "data", "products.json");
  const originalProducts = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  const original = originalProducts.find((product) => product.slug === "agency");

  await publishScript.applyPublishPayload(tempRoot, {
    metadata: {
      currency: "USD",
      price: "6.99",
      priceCents: 699,
      saleEnabled: true,
      saleEnd: "2026-07-31",
      saleLabel: "Event Sale",
      salePrice: "4.99",
      salePriceCents: 499,
      saleStart: "2026-07-01",
      slug: "agency"
    },
    operation: "pricing_update",
    pricingConfirmation: {
      nonPurchasableSaleConfirmed: true
    }
  });

  const updatedProducts = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  assert.equal(updatedProducts.length, originalProducts.length, "Pricing updates must not create duplicate product records.");
  const updated = updatedProducts.find((product) => product.slug === "agency");
  assert.equal(updated.price, "6.99", "Pricing updates should change the regular display price.");
  assert.equal(updated.priceCents, 699, "Pricing updates should change the regular cent value.");
  assert.equal(updated.regularPrice, "6.99", "Pricing updates should synchronize the derived regular price display.");
  assert.equal(updated.regularPriceCents, 699, "Pricing updates should synchronize the derived regular price cents.");
  assert.equal(updated.salePrice, "4.99", "Pricing updates should change the sale display price.");
  assert.equal(updated.salePriceCents, 499, "Pricing updates should change the sale cent value.");
  assert.equal(updated.saleStart, "2026-07-01", "Pricing updates should persist sale start dates.");
  assert.equal(updated.saleEnd, "2026-07-31", "Pricing updates should persist sale end dates.");
  assert.equal(updated.saleLabel, "Event Sale", "Pricing updates should persist sale labels.");
  assert.equal(updated.status, original.status, "Pricing updates must not change product status.");
  assert.equal(updated.buyMode, original.buyMode, "Pricing updates must not change buy mode.");
  assert.equal(updated.buyUrl, original.buyUrl, "Pricing updates must not change buy URLs.");
  assert.equal(updated.shortDescription, original.shortDescription, "Pricing updates must preserve unrelated copy.");
  assert.deepEqual(updated.authors, original.authors, "Pricing updates must preserve authors.");
  assert.equal(updated.coverImage, original.coverImage, "Pricing updates must preserve artwork paths.");
}

async function testPricingUpdateRejectsInvalidMoney(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await assert.rejects(
    publishScript.applyPublishPayload(tempRoot, {
      metadata: {
        currency: "USD",
        price: "4.999",
        priceCents: 500,
        saleEnabled: false,
        saleEnd: "",
        saleLabel: "",
        salePrice: "",
        salePriceCents: null,
        saleStart: "",
        slug: "agency"
      },
      operation: "pricing_update",
      pricingConfirmation: {
        nonPurchasableSaleConfirmed: true
      }
    }),
    /valid dollar amount|must match/,
    "Pricing updates should reject malformed or mismatched prices."
  );
}

async function testPricingUpdateRejectsSaleAboveRegular(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await assert.rejects(
    publishScript.applyPublishPayload(tempRoot, {
      metadata: {
        currency: "USD",
        price: "4.99",
        priceCents: 499,
        saleEnabled: true,
        saleEnd: "",
        saleLabel: "",
        salePrice: "4.99",
        salePriceCents: 499,
        saleStart: "",
        slug: "agency"
      },
      operation: "pricing_update",
      pricingConfirmation: {
        nonPurchasableSaleConfirmed: true
      }
    }),
    /Sale price must be lower than the regular price/,
    "Pricing updates should reject sale prices that are not lower than the regular price."
  );
}

async function testPricingUpdateRejectsInvalidDates(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await assert.rejects(
    publishScript.applyPublishPayload(tempRoot, {
      metadata: {
        currency: "USD",
        price: "4.99",
        priceCents: 499,
        saleEnabled: true,
        saleEnd: "2026-07-01",
        saleLabel: "",
        salePrice: "3.99",
        salePriceCents: 399,
        saleStart: "2026-07-15",
        slug: "agency"
      },
      operation: "pricing_update",
      pricingConfirmation: {
        nonPurchasableSaleConfirmed: true
      }
    }),
    /Sale end cannot be earlier than sale start/,
    "Pricing updates should reject inverted sale schedules."
  );
}

async function testPricingUpdateRequiresConfirmationForNonPaidSaleFields(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await assert.rejects(
    publishScript.applyPublishPayload(tempRoot, {
      metadata: {
        currency: "USD",
        price: "5.99",
        priceCents: 599,
        saleEnabled: true,
        saleEnd: "",
        saleLabel: "Preview Sale",
        salePrice: "4.99",
        salePriceCents: 499,
        saleStart: "",
        slug: "sirrocans"
      },
      operation: "pricing_update",
      pricingConfirmation: {
        nonPurchasableSaleConfirmed: false
      }
    }),
    /Confirm catalog-only sale metadata/,
    "Preview-mode products should require explicit confirmation before sale metadata is saved."
  );
}

async function testPricingUpdateBuildConsistency(publishScript) {
  const tempRoot = createTempRepo([
    "data/authors.js",
    "data/products.json",
    "scripts/build-runtime-catalog.mjs",
    "scripts/build-store.js",
    "shared/pricing.js"
  ]);
  const productsPath = path.join(tempRoot, "data", "products.json");
  const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
  const fixtureAgency = products.find((product) => product.slug === "agency");
  fixtureAgency.status = "available-direct";
  fixtureAgency.statusLabel = "Available Direct";
  fixtureAgency.buyMode = "fixed-price";
  fixtureAgency.buyUrl = "https://example.com/buy/agency";
  fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);

  await publishScript.applyPublishPayload(tempRoot, {
    metadata: {
      currency: "USD",
      price: "6.99",
      priceCents: 699,
      saleEnabled: true,
      saleEnd: "2026-08-15",
      saleLabel: "Event Sale",
      salePrice: "4.99",
      salePriceCents: 499,
      saleStart: "2026-08-01",
      slug: "agency"
    },
    operation: "pricing_update",
    pricingConfirmation: {
      nonPurchasableSaleConfirmed: true
    }
  });

  const build = spawnSync(process.execPath, [path.join(tempRoot, "scripts", "build-store.js")], {
    cwd: tempRoot,
    encoding: "utf8"
  });
  assert.equal(build.status, 0, `Pricing update build should succeed. ${build.stderr || build.stdout}`);

  const runtimeCatalogModule = await import(`${pathToFileURL(path.join(tempRoot, "shared", "runtime-catalog.mjs")).href}?cacheBust=${Date.now()}`);
  const runtimeAgency = runtimeCatalogModule.RUNTIME_CATALOG_PRODUCTS.find((product) => product.slug === "agency");
  assert.equal(runtimeAgency.priceCents, 699, "Runtime catalog should regenerate with the updated regular price.");
  assert.equal(runtimeAgency.salePriceCents, 499, "Runtime catalog should regenerate with the updated sale price.");

  const productPagePath = path.join(tempRoot, "store", "products", "agency", "index.html");
  assert.ok(fs.existsSync(productPagePath), "Generated store pages should be rebuilt after a pricing update.");
}

async function testPublishScriptRejectsInvalidCartMetadata(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await assert.rejects(
    publishScript.applyPublishPayload(tempRoot, {
      folder: "cart-bad-fixture",
      metadata: {
        buyMode: "cart",
        gameSystem: "System Neutral",
        longDescription: "Invalid cart fixture",
        price: "",
        productLine: "Other Games & Experiments",
        shortDescription: "Invalid cart fixture",
        slug: "cart-bad-fixture",
        status: "available-direct",
        subtitle: "Invalid cart fixture",
        title: "Cart Bad Fixture"
      }
    }),
    /Cart products require a positive price/,
    "Publish script should reject invalid cart pricing."
  );
}

async function testPublishScriptNormalizesCartBuyUrl(publishScript) {
  const tempRoot = createTempRepo(["data/products.json", "data/product-intake-map.json", "shared/product-folder-map.mjs"]);
  await publishScript.applyPublishPayload(tempRoot, {
    folder: "cart-good-fixture",
    metadata: {
      buyMode: "cart",
      buyUrl: "https://example.com/not-used",
      gameSystem: "System Neutral",
      longDescription: "Cart fixture",
      price: "3.99",
      productLine: "Other Games & Experiments",
      shortDescription: "Cart fixture",
      slug: "cart-good-fixture",
      status: "available-direct",
      subtitle: "Cart fixture",
      title: "Cart Good Fixture"
    }
  });

  const updatedProducts = JSON.parse(fs.readFileSync(path.join(tempRoot, "data", "products.json"), "utf8"));
  const fixture = updatedProducts.find((product) => product.slug === "cart-good-fixture");
  assert.equal(fixture.buyUrl, "", "Cart products should normalize buyUrl to an empty string.");
}

async function testNewProductBuildAndSharedMap(publishScript) {
  const tempRoot = createTempRepo([
    "data/authors.js",
    "data/product-intake-map.json",
    "data/products.json",
    "scripts/build-runtime-catalog.mjs",
    "scripts/build-store.js",
    "shared/pricing.js",
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

function addRequiredTextFields(formData, overrides = {}) {
  const fields = {
    title: "New Product",
    slug: "new-product",
    folder: "new-product",
    subtitle: "A test product",
    gameSystem: "System Neutral",
    gameSystemSlug: "system-neutral",
    productLine: "Other Games & Experiments",
    productLineSlug: "other-games-and-experiments",
    series: "Tablecraft",
    seriesSlug: "tablecraft",
    format: "PDF",
    status: "preview-available",
    buyMode: "preview-only",
    shortDescription: "Short description",
    longDescription: "Long description",
    version: "1.0",
    ...overrides
  };

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
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

function buildAuthenticatedPricingRequest(payload, cookieHeader) {
  const csrfToken = readCookieFromHeader(cookieHeader, "trg_owner_csrf");
  return new Request("https://example.com/owner/api/pricing", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
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
