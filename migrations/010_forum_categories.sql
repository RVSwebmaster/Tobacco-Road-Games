PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forum_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (slug = lower(slug)),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forum_categories_public_order
  ON forum_categories (status, display_order, slug);

INSERT OR IGNORE INTO forum_categories (id, slug, display_name, description, display_order, status, created_at, updated_at) VALUES
  ('forum-category-common-room', 'the-common-room', 'The Common Room', 'General tabletop roleplaying discussion.', 10, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('forum-category-workbench', 'at-the-workbench', 'At the Workbench', 'Game design, writing, publishing, layout, art, and production.', 20, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('forum-category-trg', 'tobacco-road-games', 'Tobacco Road Games', 'TRG announcements, products, development notes, and publisher discussion.', 30, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('forum-category-playtest-table', 'the-playtest-table', 'The Playtest Table', 'Playtesting opportunities, feedback, and test reports.', 40, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('forum-category-campaign-journals', 'campaign-journals', 'Campaign Journals', 'Actual-play reports, campaign records, characters, and table stories.', 50, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('forum-category-off-road', 'off-the-road', 'Off the Road', 'Conversation not directly related to tabletop gaming.', 60, 'active', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
