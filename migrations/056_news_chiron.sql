PRAGMA foreign_keys = ON;

CREATE TABLE news_sources (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('external_feed','trg_owner')),
  display_name TEXT NOT NULL,
  feed_url TEXT,
  terms_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_kind, display_name)
);

CREATE TABLE news_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  headline TEXT NOT NULL,
  article_url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  external_key TEXT NOT NULL UNIQUE,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES news_sources(id) ON DELETE RESTRICT
);

CREATE INDEX idx_news_items_public ON news_items(status, expires_at, priority, published_at);
CREATE INDEX idx_news_items_source ON news_items(source_id, external_key);

CREATE TABLE news_editorial_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_item_id TEXT,
  source_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(news_item_id) REFERENCES news_items(id) ON DELETE SET NULL,
  FOREIGN KEY(source_id) REFERENCES news_sources(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO news_sources(id,source_kind,display_name,feed_url,terms_url,enabled,created_at,updated_at)
VALUES('source-bols','external_feed','Bell of Lost Souls','https://www.belloflostsouls.net/feed','https://www.belloflostsouls.net/bols-terms-of-use',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO news_sources(id,source_kind,display_name,feed_url,terms_url,enabled,created_at,updated_at)
VALUES('source-trg-owner','trg_owner','Tobacco Road Games announcements',NULL,NULL,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
