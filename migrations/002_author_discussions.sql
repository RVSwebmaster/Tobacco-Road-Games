PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS discussion_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  author_slug TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_threads_author_activity
  ON discussion_threads (author_slug, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS discussion_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  thread_id INTEGER NOT NULL,
  parent_id INTEGER,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  is_author INTEGER NOT NULL DEFAULT 0 CHECK (is_author IN (0, 1)),
  verification_hash TEXT UNIQUE,
  verification_expires_at TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES discussion_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES discussion_comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discussion_comments_thread_status
  ON discussion_comments (thread_id, status, created_at);

CREATE TABLE IF NOT EXISTS discussion_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, email_normalized),
  FOREIGN KEY (thread_id) REFERENCES discussion_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discussion_rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL,
  window_started_at TEXT NOT NULL
);
