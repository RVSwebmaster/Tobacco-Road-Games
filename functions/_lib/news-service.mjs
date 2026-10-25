const MAX_ITEMS = 24;
const BOlS_SOURCE_ID = "source-bols";

function rows(result) { return result?.results || []; }

function cleanText(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value = "") {
  return cleanText(value).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return decodeXml(match?.[1] || "");
}

export function parseNewsFeed(xml, source = {}) {
  const sourceId = String(source.id || BOlS_SOURCE_ID);
  const sourceName = String(source.display_name || source.displayName || "External source");
  const blocks = [...String(xml).matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map((match) => match[1]);
  return blocks.map((block) => {
    const headline = tag(block, "title");
    const linkMatch = block.match(/<link(?:\s[^>]*)?href=["']([^"']+)["'][^>]*>/i);
    const articleUrl = linkMatch?.[1] || tag(block, "link") || tag(block, "guid");
    const publishedAt = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    const externalKey = tag(block, "guid") || articleUrl || `${headline}|${publishedAt}`;
    const stamp = new Date(publishedAt || Date.now());
    if (!headline || !/^https:\/\//i.test(articleUrl) || !Number.isFinite(stamp.getTime())) return null;
    return { sourceId, sourceName, headline: headline.slice(0, 240), articleUrl, publishedAt: stamp.toISOString(), externalKey: externalKey.slice(0, 500) };
  }).filter(Boolean);
}

function expiryFor(publishedAt, days = 14) {
  const date = new Date(publishedAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export async function listPublicNews(db, now = new Date()) {
  const current = new Date(now).toISOString();
  const result = await db.prepare("SELECT id,source_name AS sourceName,headline,article_url AS articleUrl,published_at AS publishedAt,expires_at AS expiresAt,priority FROM news_items WHERE status='published' AND expires_at>? ORDER BY priority DESC,published_at DESC LIMIT ?").bind(current, MAX_ITEMS).all();
  return rows(result);
}

export async function listEditorialNews(db) {
  const result = await db.prepare("SELECT n.*,s.source_kind AS sourceKind,s.display_name AS configuredSourceName,s.enabled AS sourceEnabled FROM news_items n JOIN news_sources s ON s.id=n.source_id ORDER BY n.status='published' DESC,n.priority DESC,n.published_at DESC LIMIT 200").all();
  return rows(result);
}

export async function listNewsSources(db) {
  const result = await db.prepare("SELECT id,source_kind AS sourceKind,display_name AS displayName,feed_url AS feedUrl,terms_url AS termsUrl,enabled,updated_at AS updatedAt FROM news_sources ORDER BY display_name").all();
  return rows(result);
}

export async function updateNewsSource(db, id, enabled, actorId, now = Date.now()) {
  const sourceId = String(id || "");
  if (!["source-bols", "source-trg-owner"].includes(sourceId)) throw new Error("News source is not configured.");
  const value = enabled ? 1 : 0;
  const nowIso = new Date(now).toISOString();
  const result = await db.prepare("UPDATE news_sources SET enabled=?,updated_at=? WHERE id=?").bind(value, nowIso, sourceId).run();
  if (!Number(result?.meta?.changes)) throw new Error("News source was not found.");
  await db.prepare("INSERT INTO news_editorial_audit(source_id,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?)").bind(sourceId, actorId, value ? "owner_source_enabled" : "owner_source_disabled", JSON.stringify({ enabled: Boolean(value) }), nowIso).run();
  return { id: sourceId, enabled: value };
}

export async function collectSource(db, source, fetchImpl = fetch, now = Date.now()) {
  if (!source?.enabled || !source.feed_url) return { sourceId: source?.id, fetched: false, inserted: 0, reason: "disabled" };
  const response = await fetchImpl(source.feed_url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!response.ok) throw new Error(`News feed returned HTTP ${response.status}.`);
  const parsed = parseNewsFeed(await response.text(), source).slice(0, MAX_ITEMS);
  const createdAt = new Date(now).toISOString();
  let inserted = 0;
  for (const item of parsed) {
    const existing = await db.prepare("SELECT id,status FROM news_items WHERE external_key=?").bind(item.externalKey).first();
    if (existing?.status === "archived") continue;
    if (existing) {
      await db.prepare("UPDATE news_items SET headline=?,article_url=?,published_at=?,source_name=?,expires_at=?,updated_at=? WHERE external_key=?").bind(item.headline, item.articleUrl, item.publishedAt, item.sourceName, expiryFor(item.publishedAt), createdAt, item.externalKey).run();
      continue;
    }
    await db.prepare("INSERT INTO news_items(id,source_id,source_name,headline,article_url,published_at,expires_at,status,priority,external_key,created_at,updated_at) VALUES(?,?,?,?,?, ?,?,'published',0,?,?,?)").bind(crypto.randomUUID(), item.sourceId, item.sourceName, item.headline, item.articleUrl, item.publishedAt, expiryFor(item.publishedAt), item.externalKey, createdAt, createdAt).run();
    inserted += 1;
  }
  return { sourceId: source.id, fetched: true, parsed: parsed.length, inserted };
}

export async function createOwnerAnnouncement(db, { headline, articleUrl, publishedAt, expiresAt, priority = 0, actorId, now = Date.now() }) {
  const title = String(headline || "").trim();
  const url = String(articleUrl || "").trim();
  if (!title || title.length > 240 || !/^https:\/\//i.test(url)) throw new Error("TRG announcements require a headline and HTTPS source URL.");
  const createdAt = new Date(now).toISOString();
  const published = new Date(publishedAt || now);
  const expiry = new Date(expiresAt || (published.getTime() + 30 * 86400000));
  if (!Number.isFinite(published.getTime()) || !Number.isFinite(expiry.getTime()) || expiry <= published) throw new Error("News dates are invalid.");
  const id = crypto.randomUUID();
  const key = `trg:${id}`;
  await db.batch([
    db.prepare("INSERT INTO news_items(id,source_id,source_name,headline,article_url,published_at,expires_at,status,priority,external_key,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?, ?,?,'published',?,?,?, ?,?,?)").bind(id, "source-trg-owner", "Tobacco Road Games", title, url, published.toISOString(), expiry.toISOString(), Math.max(-100, Math.min(100, Number(priority) || 0)), key, actorId, actorId, createdAt, createdAt),
    db.prepare("INSERT INTO news_editorial_audit(news_item_id,source_id,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?,?)").bind(id, "source-trg-owner", actorId, "owner_announcement_published", JSON.stringify({ headline: title }), createdAt)
  ]);
  return { id, headline: title };
}

export async function updateOwnerNews(db, id, payload, actorId, now = Date.now()) {
  const status = ["draft", "published", "archived"].includes(payload.status) ? payload.status : null;
  const priority = Number.isFinite(Number(payload.priority)) ? Math.max(-100, Math.min(100, Number(payload.priority))) : null;
  const expiry = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (payload.articleUrl && !/^https:\/\//i.test(String(payload.articleUrl))) throw new Error("News links must use HTTPS.");
  const nowIso = new Date(now).toISOString();
  const result = await db.prepare("UPDATE news_items SET status=COALESCE(?,status),priority=COALESCE(?,priority),expires_at=COALESCE(?,expires_at),updated_by=?,updated_at=? WHERE id=?").bind(status, priority, expiry && Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null, actorId, nowIso, id).run();
  if (!Number(result?.meta?.changes)) throw new Error("News item was not found.");
  await db.prepare("INSERT INTO news_editorial_audit(news_item_id,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?)").bind(id, actorId, `owner_news_${status || "updated"}`, JSON.stringify({ status, priority }), nowIso).run();
  return { id, status, priority };
}

export { expiryFor };
