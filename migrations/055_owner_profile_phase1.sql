PRAGMA foreign_keys = ON;

CREATE TABLE account_profile_preferences (
  user_id TEXT PRIMARY KEY,
  appearance_mode TEXT NOT NULL DEFAULT 'night' CHECK(appearance_mode IN ('day','night')),
  wallpaper_kind TEXT NOT NULL DEFAULT 'solid' CHECK(wallpaper_kind IN ('solid','prepared')),
  wallpaper_key TEXT NOT NULL DEFAULT 'walnut',
  wallpaper_color TEXT NOT NULL DEFAULT '#20150f',
  wallpaper_saturation INTEGER NOT NULL DEFAULT 100 CHECK(wallpaper_saturation BETWEEN 0 AND 150),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE account_library_shelf_selections (
  user_id TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 36),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, product_slug),
  UNIQUE(user_id, position),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE creator_profile_shelf_selections (
  creator_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 12),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(creator_id, listing_id),
  UNIQUE(creator_id, position),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE,
  FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE CASCADE
);

CREATE TABLE creator_profile_posters (
  creator_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 2),
  asset_key TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  owner_managed INTEGER NOT NULL DEFAULT 1 CHECK(owner_managed = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(creator_id, slot),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE
);

CREATE TABLE profile_customization_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  creator_id TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','account','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE SET NULL
);

CREATE INDEX idx_profile_customization_audit_subject
  ON profile_customization_audit(creator_id, user_id, created_at);
