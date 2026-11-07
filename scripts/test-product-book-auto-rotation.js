const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const vm = require("node:vm");
const { applyMigrations, createD1, load } = require("./test-creator-product-withdrawal.js");

async function main() {
  const storefront = await load("functions/_lib/public-storefront.mjs");
  const catalog = await load("functions/_lib/product-catalog-d1.mjs");
  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec("PRAGMA foreign_keys=ON;");
    applyMigrations(raw);
    const database = createD1(raw);
    const date = "2026-11-07T12:00:00.000Z";
    const cases = [
      { slug: "owner-book-test", role: "owner", eligible: true },
      { slug: "admin-book-test", role: "admin", eligible: true },
      { slug: "founding-book-test", role: "user", founding: true, eligible: true },
      { slug: "ordinary-book-test", role: "user", eligible: false }
    ];
    for (const item of cases) {
      const userId = `user-${item.slug}`;
      const creatorId = `creator-${item.slug}`;
      raw.prepare("INSERT INTO users(id,email_normalized,email_verified,status,role,created_at,updated_at) VALUES(?,?,1,'active',?,?,?)")
        .run(userId, `${item.slug}@example.invalid`, item.role, date, date);
      raw.prepare(`INSERT INTO marketplace_creators
        (id,slug,display_name,marketplace_status,registration_status,closure_state,created_at,updated_at)
        VALUES (?,?,?,'approved','active','active',?,?)`)
        .run(creatorId, item.slug, `Test ${item.slug}`, date, date);
      raw.prepare(`INSERT INTO creator_identity_ownership
        (creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at)
        VALUES (?,?,'primary','active','not_required','primary_free',?,?)`)
        .run(creatorId, userId, date, date);
      if (item.founding) {
        raw.prepare(`INSERT INTO creator_badge_awards
          (id,creator_id,badge_id,source,awarded_at,awarded_by,created_at)
          VALUES (?,?,'founding-creator','founding_window',?,'owner',?)`)
          .run(`badge-${item.slug}`, creatorId, date, date);
      }
      await catalog.createProduct(database, {
        id: item.slug, slug: item.slug, creatorId,
        publicationState: "published", title: item.slug,
        status: "free-download", buyMode: "free-download", pricingModel: "free", priceCents: 0,
        publisher: "Owner Publishing", metadata: { authors: ["Owner Author"], pageCount: 122 }
      });
      assert.equal(await storefront.isAutoRotationEligible(database, creatorId), item.eligible, item.slug);
      const response = await storefront.handlePublicProductPage({
        request: new Request(`https://example.com/store/products/${item.slug}/`),
        params: { slug: item.slug }, env: { TRG_ORDERS: database }
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.equal(html.includes('data-auto-rotate="true"'), item.eligible, item.slug);
      assert.match(html, /data-product-book/);
      assert.match(html, /data-page-count="122"/);
    }
    const ordinary = cases[3];
    raw.prepare("UPDATE users SET role='admin' WHERE id=?").run(`user-${ordinary.slug}`);
    assert.equal(await storefront.isAutoRotationEligible(database, `creator-${ordinary.slug}`), true,
      "An authoritative account role change changes eligibility.");
    raw.prepare("UPDATE users SET role='user' WHERE id=?").run(`user-${ordinary.slug}`);
    raw.prepare("UPDATE creator_badge_awards SET state='revoked' WHERE creator_id=?").run(`creator-${cases[2].slug}`);
    assert.equal(await storefront.isAutoRotationEligible(database, `creator-${cases[2].slug}`), false,
      "A revoked Founding Creator badge does not qualify.");
    raw.prepare("UPDATE users SET status='disabled' WHERE id=?").run(`user-${cases[0].slug}`);
    assert.equal(await storefront.isAutoRotationEligible(database, `creator-${cases[0].slug}`), false,
      "An inactive management account does not qualify.");
    testMotionControls();
    console.log("Product book D1 eligibility tests passed.");
  } finally { raw.close(); }
}

function testMotionControls() {
  const auto = bookHarness({ eligible: true });
  assert.equal(auto.button.textContent, "Pause rotation");
  auto.frame(0);
  auto.frame(1000);
  assert.ok(Math.abs(auto.angle() - 12) < 0.3, "Automatic motion takes about 30 seconds per revolution.");
  auto.button.dispatch("click");
  const paused = auto.angle();
  auto.frame(2000);
  assert.equal(auto.angle(), paused, "Pause preserves the exact angle.");
  auto.button.dispatch("click");
  auto.frame(2000);
  auto.frame(3000);
  assert.ok(auto.angle() > paused && auto.angle() < paused + 13, "Resume continues from the paused angle.");
  auto.slider.dispatch("pointerdown");
  auto.slider.value = "180";
  auto.slider.dispatch("input");
  assert.equal(auto.angle(), 180);
  assert.equal(auto.button.textContent, "Resume rotation");
  auto.frame(4000);
  assert.equal(auto.angle(), 180, "Manual slider interaction stops automatic motion.");
  auto.button.dispatch("click");
  auto.slider.dispatch("keydown");
  assert.equal(auto.button.textContent, "Resume rotation", "Keyboard interaction stops automatic motion.");
  auto.button.dispatch("click");
  auto.document.hidden = true;
  auto.document.dispatch("visibilitychange");
  assert.equal(auto.button.textContent, "Resume rotation");
  auto.document.hidden = false;
  auto.document.dispatch("visibilitychange");
  assert.equal(auto.button.textContent, "Resume rotation", "Returning to the tab does not restart motion.");

  const reduced = bookHarness({ eligible: true, reduced: true });
  assert.equal(reduced.button.textContent, "Resume rotation", "Reduced motion starts paused.");
  reduced.frame(1000);
  assert.equal(reduced.angle(), 0);
  const ordinary = bookHarness({ eligible: false });
  assert.equal(ordinary.button, null, "Ordinary Creator books have no automatic control.");
  ordinary.frame(1000);
  assert.equal(ordinary.angle(), 0);
}

function bookHarness({ eligible, reduced = false }) {
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
      this.classList = { values: new Set(), add(value) { this.values.add(value); }, toggle(value, active) { active ? this.values.add(value) : this.values.delete(value); } };
      this.clientWidth = 680;
      this.clientHeight = 400;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    dispatch(name) { this.listeners[name]?.({}); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const cover = new Element("img");
  cover.naturalWidth = 900;
  cover.naturalHeight = 1200;
  const media = new Element();
  media.dataset = { autoRotate: eligible ? "true" : "", pageCount: "122", spineCredit: "Fixture" };
  media.querySelector = selector => selector === ".product-cover" ? cover : null;
  media.closest = () => ({ querySelector: () => ({ textContent: "Fixture book" }) });
  const document = {
    hidden: false,
    readyState: "complete",
    listeners: {},
    createElement: tag => new Element(tag),
    querySelectorAll: () => [media],
    addEventListener(name, listener) { this.listeners[name] = listener; },
    dispatch(name) { this.listeners[name]?.({}); }
  };
  let now = 0, nextFrame = 0;
  const frames = new Map();
  const window = {
    innerWidth: 1280,
    performance: { now: () => now },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {}
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "product-book.js"), "utf8");
  vm.runInNewContext(source, {
    document, window,
    getComputedStyle: () => ({ paddingLeft: "80", paddingRight: "80", paddingTop: "24", paddingBottom: "24" })
  });
  const stage = media.children[0], control = media.children[1];
  const book = stage.children[0];
  return {
    document,
    slider: control.children[1],
    button: control.children[2] || null,
    angle: () => Number.parseFloat(book.style.values["--book-angle"]),
    frame(time) {
      while (now < time) {
        now = Math.min(time, now + 16);
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(now));
      }
    }
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
