PRAGMA foreign_keys = ON;

ALTER TABLE forum_profiles ADD COLUMN avatar_object_key TEXT;
ALTER TABLE forum_profiles ADD COLUMN avatar_media_type TEXT;
ALTER TABLE forum_profiles ADD COLUMN avatar_preset_id TEXT;
ALTER TABLE forum_profiles ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forum_profiles ADD COLUMN avatar_updated_at TEXT;
