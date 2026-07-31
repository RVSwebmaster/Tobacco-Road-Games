PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forum_profiles (
  user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  handle_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  biography TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forum_profiles_public_handle
  ON forum_profiles (status, handle_normalized);

CREATE TRIGGER IF NOT EXISTS deactivate_forum_profile_with_user
AFTER UPDATE OF status ON users
WHEN NEW.status <> 'active'
BEGIN
  UPDATE forum_profiles
  SET status = 'inactive', updated_at = NEW.updated_at
  WHERE user_id = NEW.id AND status = 'active';
END;
