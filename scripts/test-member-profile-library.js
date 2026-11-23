const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "assets/js/member-profile-library.js"), "utf8");

function element(children = []) {
  return {
    children,
    get childNodes() { return this.children; },
    replaceChildren(...next) { this.children = next; }
  };
}

async function run(accounts) {
  const rows = [element(), element()];
  const requests = [];
  const events = [];
  const listeners = { window: {}, document: {} };
  const doc = {
    hidden: false,
    querySelectorAll(selector) { return selector === "[data-member-library-books]" ? rows : []; },
    dispatchEvent(event) { events.push(event.type); },
    addEventListener(type, listener) { listeners.document[type] = listener; }
  };
  const context = {
    document: doc,
    window: {
      addEventListener(type, listener) { listeners.window[type] = listener; }
    },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.equal(url, "/api/account/me", "Profile shelf refresh checks only the authenticated account.");
      const account = accounts.shift();
      return { ok: true, json: async () => account };
    }
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { rows, requests, events, listeners, doc };
}

(async () => {
  const signedOut = await run([{ authenticated: false }]);
  assert.deepEqual(signedOut.requests.map(({ url }) => url), ["/api/account/me"]);
  assert.deepEqual(signedOut.rows.map((row) => row.children.length), [0, 0]);
  assert.doesNotMatch(source, /api\/account\/library|slice\(|preferredWidth|--shelf-items|MOCK_BOOKS|preview-library|creator-preview|creatorPreviewOnly|tobacco-road-games-logo\.png/,
    "Profiles do not select purchases automatically, simulate books, or shrink spines to a guessed shelf count.");

  const member = await run([
    { authenticated: true, user: { id: "member-a" } },
    { authenticated: true, user: { id: "member-b" } },
    { authenticated: false }
  ]);
  assert.deepEqual(member.requests.map(({ url }) => url), ["/api/account/me"]);
  assert.ok(member.requests.every(({ options }) => options.credentials === "same-origin" && options.cache === "no-store"));
  assert.equal(typeof member.listeners.window.focus, "function", "Returning to a Profile rechecks its authenticated account.");
  assert.equal(typeof member.listeners.window.pageshow, "function", "Restoring a cached Profile rechecks its authenticated account.");
  assert.equal(typeof member.listeners.document.visibilitychange, "function", "A visible Profile rechecks its authenticated account.");
  assert.equal(typeof member.listeners.document["trg:account-changed"], "function", "An account-change event refreshes the Profile.");

  member.rows[0].replaceChildren(element(["previous member book"]));
  member.listeners.window.focus();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(member.rows.map((row) => row.children.length), [0, 0],
    "Changing authenticated account clears any previously displayed Member library content.");
  member.rows[1].replaceChildren(element(["member book"]));
  member.listeners.document["trg:account-changed"]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(member.rows.map((row) => row.children.length), [0, 0],
    "Signing out clears previously displayed Member library content.");
  assert.deepEqual(member.events, ["trg:member-library-updated", "trg:member-library-updated"]);
  console.log("Member Profile account-change and no-selection library tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
