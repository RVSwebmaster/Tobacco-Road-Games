PRAGMA foreign_keys = ON;

CREATE TABLE forum_action_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('topic','reply','report')),
  destination_id TEXT NOT NULL,
  content_fingerprint TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_forum_action_events_user_window ON forum_action_events (user_id, action_type, created_at);
CREATE INDEX idx_forum_action_events_ip_window ON forum_action_events (ip_hash, action_type, created_at);
CREATE INDEX idx_forum_action_events_duplicate ON forum_action_events (user_id, action_type, destination_id, content_fingerprint, created_at);
