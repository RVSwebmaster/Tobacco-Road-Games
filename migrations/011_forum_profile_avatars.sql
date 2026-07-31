PRAGMA foreign_keys = ON;

ALTER TABLE forum_profiles ADD COLUMN avatar_object_key TEXT;
ALTER TABLE forum_profiles ADD COLUMN avatar_media_type TEXT;
ALTER TABLE forum_profiles ADD COLUMN avatar_preset_id TEXT CHECK (
  (avatar_preset_id IS NULL AND avatar_object_key IS NULL AND avatar_media_type IS NULL)
  OR (avatar_preset_id IS NOT NULL AND avatar_object_key IS NULL AND avatar_media_type IS NULL)
  OR (avatar_preset_id IS NULL AND avatar_object_key IS NOT NULL AND avatar_media_type IS NOT NULL)
);
ALTER TABLE forum_profiles ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forum_profiles ADD COLUMN avatar_updated_at TEXT;
