PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forum_topics (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  creator_profile_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 120),
  slug TEXT NOT NULL CHECK (slug = lower(slug)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES forum_categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (creator_profile_id) REFERENCES forum_profiles(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_forum_topics_category_activity
  ON forum_topics (category_id, status, last_activity_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  author_profile_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (topic_id) REFERENCES forum_topics(id) ON DELETE CASCADE,
  FOREIGN KEY (author_profile_id) REFERENCES forum_profiles(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_topic_created
  ON forum_posts (topic_id, status, created_at, id);
