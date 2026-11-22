const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "account.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "assets/js/account.js"), "utf8");

function assertNativeAccountMarkup() {
  assert.doesNotMatch(page, /Google|google|accounts\.google/i);
  for (const id of ["signin-form", "register-form", "forgot-form", "reset-form", "account-status"]) {
    assert.match(page, new RegExp(`id=[\"']${id}[\"']`), `Missing account flow control: ${id}`);
  }
  assert.match(page, /data-account-view="register"[^>]*>Sign Up<\/a>/);
  assert.match(page, /data-account-view="forgot"[^>]*>Forgot Password\?/);
  assert.match(page, /data-account-view="signin"[^>]*>Back to Sign In<\/a>/);
  assert.doesNotMatch(page, /resend-verification/i, "Resend verification is not part of the Customer account flow.");
  assert.match(page, /id="signout-button"/);
  assert.doesNotMatch(script, /Google|google|\/api\/auth\/google/i);
  for (const endpoint of [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/request-password-reset",
    "/api/auth/verify-email",
    "/api/auth/reset-password",
    "/api/auth/logout",
  ]) assert.ok(script.includes(endpoint), `Missing native account action: ${endpoint}`);
  assert.match(script, /window\.location\.assign\("\/customer"\)/);
}

function createElement(id) {
  return {
    id,
    hidden: false,
    textContent: "",
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    focus() { this.focused = true; },
    querySelector() { return createElement(`${id}-first-input`); },
    addEventListener() {},
  };
}

async function testAccountViewNavigation() {
  const ids = [
    "account-status", "account-summary", "signout-button",
    "account-access-panel", "account-session-panel", "account-signin-panel",
    "account-register-panel", "account-forgot-panel",
  ];
  const elements = new Map(ids.map((id) => [`#${id}`, createElement(id)]));
  const listeners = new Map();
  const document = {
    querySelector(selector) { return elements.get(selector) || null; },
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const window = { location: { href: "https://tobacco-road-games-staging.pages.dev/account.html" } };
  const context = {
    document,
    window,
    URL,
    URLSearchParams,
    sessionStorage: { getItem() { return ""; }, setItem() {} },
    history: { replaceState() {} },
    fetch: async () => Response.json({ authenticated: false, csrfToken: "csrf", user: null }),
    setTimeout,
    console,
  };
  vm.runInNewContext(script, context, { filename: "account.js" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("#account-signin-panel").hidden, false);
  assert.equal(elements.get("#account-register-panel").hidden, true);
  assert.equal(elements.get("#account-forgot-panel").hidden, true);
  const link = { dataset: { accountView: "register" }, preventDefault() {}, closest() { return this; } };
  listeners.get("click")({ target: { closest() { return link; } }, preventDefault() {} });
  assert.equal(elements.get("#account-signin-panel").hidden, true);
  assert.equal(elements.get("#account-register-panel").hidden, false);
  assert.equal(elements.get("#account-forgot-panel").hidden, true);
  const back = { dataset: { accountView: "forgot" }, preventDefault() {}, closest() { return this; } };
  listeners.get("click")({ target: { closest() { return back; } }, preventDefault() {} });
  assert.equal(elements.get("#account-register-panel").hidden, true);
  assert.equal(elements.get("#account-forgot-panel").hidden, false);
}

(async () => {
  assertNativeAccountMarkup();
  await testAccountViewNavigation();
  console.log("Native account UI tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
