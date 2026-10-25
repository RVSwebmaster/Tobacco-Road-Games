const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const ISO = "2026-10-24T12:00:00.000Z";

function adapter(raw) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return raw.prepare(sql).get(...args) || null; },
        async all() { return { results: raw.prepare(sql).all(...args) }; },
        async run() { const result = raw.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }
      };
    },
    async batch(statements) { raw.exec("BEGIN"); try { for (const statement of statements) await statement.run(); raw.exec("COMMIT"); } catch (error) { raw.exec("ROLLBACK"); throw error; } }
  };
}

async function main() {
  const service = await import(`../functions/_lib/news-service.mjs?test=${Date.now()}`);
  const raw = new DatabaseSync(":memory:");
  raw.exec(fs.readFileSync(path.join(ROOT, "migrations", "056_news_chiron.sql"), "utf8"));
  const db = adapter(raw);
  const xml = `<?xml version="1.0"?><rss><channel><item><guid>bols-1</guid><title><![CDATA[Real TTRPG News]]></title><link>https://www.belloflostsouls.net/article</link><pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const parsed = service.parseNewsFeed(xml, { id: "source-bols", display_name: "Bell of Lost Souls" });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].headline, "Real TTRPG News");
  const source = raw.prepare("SELECT * FROM news_sources WHERE id='source-bols'").get();
  const first = await service.collectSource(db, source, async () => new Response(xml, { status: 200 }), Date.parse(ISO));
  const second = await service.collectSource(db, source, async () => new Response(xml, { status: 200 }), Date.parse(ISO));
  assert.equal(first.parsed, 1);
  assert.equal(second.inserted, 0, "The same feed item must be deduplicated.");
  assert.equal((await service.listPublicNews(db, new Date(ISO))).length, 1);
  raw.prepare("UPDATE news_items SET expires_at=?").run("2026-10-24T11:00:00.000Z");
  assert.equal((await service.listPublicNews(db, new Date(ISO))).length, 0, "Expired items must leave the public feed.");
  const owner = await service.createOwnerAnnouncement(db, { headline: "TRG Announcement", articleUrl: "https://tobaccoroadgames.com/", actorId: "owner", now: Date.parse(ISO) });
  assert.equal((await service.listPublicNews(db, new Date(ISO))).some((item) => item.id === owner.id), true);
  await service.updateOwnerNews(db, owner.id, { operation: "update", status: "archived", priority: 50 }, "owner", Date.parse(ISO));
  assert.equal((await service.listPublicNews(db, new Date(ISO))).some((item) => item.id === owner.id), false);
  const toggled = await service.updateNewsSource(db, "source-bols", false, "owner", Date.parse(ISO));
  assert.equal(toggled.enabled, 0);
  assert.equal((await service.listNewsSources(db)).find((source) => source.id === "source-bols").enabled, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM news_editorial_audit WHERE action='owner_source_disabled'").first()).count, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM news_editorial_audit").get().count, 3);
  console.log("News Chiron pipeline tests passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
