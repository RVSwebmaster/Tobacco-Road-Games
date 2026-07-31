const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const accountScript = fs.readFileSync(path.join(ROOT, "assets", "js", "account.js"), "utf8");

function createElement(id) {
  return {
    id,
    hidden: true,
    innerHTML: "",
    textContent: "",
    dataset: {},
    elements: { token: { value: "" } },
    classList: { toggle() {} },
    addEventListener() {},
    append(...children) {
      this.children = children;
    },
    reset() {
      this.resetCalled = true;
    }
  };
}

function createHarness({ googleClientId = "google-client-id", google = null } = {}) {
  const elements = new Map([
    ["account-status", createElement("account-status")],
    ["account-summary", createElement("account-summary")],
    ["signout-button", createElement("signout-button")],
    ["resend-verification-button", createElement("resend-verification-button")],
    ["reset-panel", createElement("reset-panel")],
    ["reset-form", createElement("reset-form")],
    ["signin-form", createElement("signin-form")],
    ["register-form", createElement("register-form")],
    ["forgot-form", createElement("forgot-form")],
    ["google-unavailable", createElement("google-unavailable")],
    ["google-signin-control", createElement("google-signin-control")]
  ]);
  const timeouts = [];
  const loadListeners = [];
  const requests = [];
  const calls = { initialize: [], renderButton: [] };
  const context = {
    FormData,
    URL,
    Object,
    Promise,
    console,
    decodeURIComponent,
    document: {
      cookie: "",
      documentElement: { dataset: {} },
      createElement: () => createElement("dynamic"),
      querySelector(selector) {
        if (!selector.startsWith("#")) return null;
        return elements.get(selector.slice(1)) || null;
      }
    },
    fetch: async (url, options = {}) => {
      requests.push({ options, url });
      if (url === "/api/auth/google") {
        return {
          json: async () => ({ ok: true, user: { email: "google@example.com", emailVerified: true } }),
          ok: true
        };
      }
      assert.equal(url, "/api/account/me");
      return {
        json: async () => ({
          authenticated: false,
          csrfToken: "trg-csrf",
          googleClientId,
          user: null
        }),
        ok: true
      };
    },
    history: { replaceState() {} },
    location: { href: "https://tobacco-road-games-staging.pages.dev/account" },
    setTimeout(callback) {
      timeouts.push(callback);
      return timeouts.length;
    },
    window: {
      __TRG_ACCOUNT_TEST__: {},
      addEventListener(event, callback) {
        if (event === "load") loadListeners.push(callback);
      },
      setTimeout(callback) {
        timeouts.push(callback);
        return timeouts.length;
      },
      location: { href: "https://tobacco-road-games-staging.pages.dev/account" },
      history: { replaceState() {} }
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.console = console;
  context.window.fetch = context.fetch;
  context.window.URL = URL;
  context.window.decodeURIComponent = decodeURIComponent;
  if (google) context.window.google = google(calls);

  vm.runInNewContext(accountScript, context, { filename: "account.js" });

  return { calls, context, elements, loadListeners, requests, timeouts };
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function makeGoogle(calls) {
  return {
    accounts: {
      id: {
        initialize(options) {
          calls.initialize.push(options);
        },
        renderButton(element, options) {
          calls.renderButton.push({ element, options });
        }
      }
    }
  };
}

async function testConfiguredClientAndGisAvailable() {
  const harness = createHarness({ google: makeGoogle });
  await flushMicrotasks();
  assert.equal(harness.calls.initialize.length, 1);
  assert.equal(harness.calls.initialize[0].client_id, "google-client-id");
  assert.equal(harness.calls.renderButton.length, 1);
  assert.equal(harness.elements.get("google-unavailable").hidden, true);
}

async function testGisLoadsAfterPageScript() {
  const harness = createHarness();
  await flushMicrotasks();
  assert.equal(harness.calls.initialize.length, 0);
  assert.equal(harness.elements.get("google-unavailable").hidden, true);
  harness.context.window.google = makeGoogle(harness.calls);
  harness.timeouts.shift()();
  assert.equal(harness.calls.initialize.length, 1);
  assert.equal(harness.elements.get("google-unavailable").hidden, true);
}

async function testMissingClientIdShowsUnavailable() {
  const harness = createHarness({ googleClientId: "", google: makeGoogle });
  await flushMicrotasks();
  assert.equal(harness.calls.initialize.length, 0);
  assert.equal(harness.elements.get("google-unavailable").hidden, false);
}

async function testGisScriptFailureShowsUnavailableAfterRetries() {
  const harness = createHarness();
  await flushMicrotasks();
  for (let index = 0; index < 25 && harness.timeouts.length; index += 1) {
    harness.timeouts.shift()();
  }
  assert.equal(harness.calls.initialize.length, 0);
  assert.equal(harness.elements.get("google-unavailable").hidden, false);
}

async function testNoDuplicateWidgetInitialization() {
  const harness = createHarness({ google: makeGoogle });
  await flushMicrotasks();
  harness.context.window.__TRG_ACCOUNT_TEST__.initializeGoogle();
  harness.context.window.__TRG_ACCOUNT_TEST__.scheduleGoogleInitialization();
  harness.loadListeners.forEach((callback) => callback());
  while (harness.timeouts.length) harness.timeouts.shift()();
  assert.equal(harness.calls.initialize.length, 1);
  assert.equal(harness.calls.renderButton.length, 1);
}

async function testGoogleCallbackUsesTrgCsrfHeaderOnly() {
  const harness = createHarness({ google: makeGoogle });
  await flushMicrotasks();
  await harness.context.window.handleTrgGoogleCredential({ credential: "google-jwt" });
  await flushMicrotasks();
  const request = harness.requests.find((item) => item.url === "/api/auth/google");
  assert.ok(request, "Google callback should POST to the account auth endpoint.");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-csrf-token"], "trg-csrf");
  assert.deepEqual(JSON.parse(request.options.body), { credential: "google-jwt" });
}

(async () => {
  await testConfiguredClientAndGisAvailable();
  await testGisLoadsAfterPageScript();
  await testMissingClientIdShowsUnavailable();
  await testGisScriptFailureShowsUnavailableAfterRetries();
  await testNoDuplicateWidgetInitialization();
  await testGoogleCallbackUsesTrgCsrfHeaderOnly();
  console.log("Account Google UI tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
