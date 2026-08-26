CREATE TABLE marketplace_creators (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  profile_image TEXT NOT NULL DEFAULT '', logo TEXT NOT NULL DEFAULT '', banner_image TEXT NOT NULL DEFAULT '',
  short_bio TEXT NOT NULL DEFAULT '', long_bio TEXT NOT NULL DEFAULT '',
  profile_template TEXT NOT NULL DEFAULT 'catalog' CHECK (profile_template IN ('catalog','bookshelf')),
  accent TEXT NOT NULL DEFAULT '', links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links_json)),
  marketplace_status TEXT NOT NULL DEFAULT 'approved' CHECK (marketplace_status IN ('pending','approved','suspended')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE creator_memberships (
  user_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'manager' CHECK (permission IN ('manager','editor','analyst')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, creator_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE
);

CREATE TABLE creator_listings (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, source_product_slug TEXT UNIQUE,
  title TEXT NOT NULL, short_description TEXT NOT NULL DEFAULT '', long_description TEXT NOT NULL DEFAULT '',
  lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_state IN ('draft','submitted','active','paused','needs_changes','rejected')),
  listed_price_cents INTEGER CHECK (listed_price_cents IS NULL OR listed_price_cents >= 0),
  sale_price_cents INTEGER CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0), sale_start TEXT, sale_end TEXT,
  media_type TEXT NOT NULL DEFAULT '' CHECK (media_type IN ('','digital','physical','hybrid')),
  format_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(format_json)), game_system TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '',
  discovery_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(discovery_json)), cover_image TEXT NOT NULL DEFAULT '',
  submitted_at TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_listings_owner_state ON creator_listings (creator_id, lifecycle_state, updated_at);

CREATE TABLE creator_bundles (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0), state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','active','paused')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE TABLE creator_bundle_items (
  bundle_id TEXT NOT NULL, listing_id TEXT NOT NULL, PRIMARY KEY (bundle_id, listing_id),
  FOREIGN KEY (bundle_id) REFERENCES creator_bundles(id) ON DELETE CASCADE,
  FOREIGN KEY (listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT
);

CREATE TABLE creator_review_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, creator_id TEXT NOT NULL, actor_user_id TEXT,
  action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO marketplace_creators (id,slug,display_name,short_bio,long_bio,profile_template,marketplace_status,created_at,updated_at)
VALUES ('creator-rv-sawyer','rv-sawyer','RV Sawyer','RV Sawyer is the founder of Tobacco Road Games, shaped by 46 years behind the screen across fantasy, science fiction, horror, superheroes, pulp, westerns, survival play, and stranger roads besides.','RV Sawyer writes tabletop tools, adventures, essays, and game material from the working side of the GM screen.','bookshelf','approved',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO creator_memberships (user_id,creator_id,permission,created_at)
SELECT id,'creator-rv-sawyer','manager',CURRENT_TIMESTAMP FROM users WHERE role IN ('owner','admin');

INSERT INTO creator_listings (id,creator_id,slug,source_product_slug,title,lifecycle_state,created_at,updated_at) VALUES
('listing-agency','creator-rv-sawyer','agency','agency','Agency','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-circle-of-cinder','creator-rv-sawyer','circle-of-cinder','circle-of-cinder','Circle of Cinder','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-final-flame','creator-rv-sawyer','final-flame','final-flame','Final Flame','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-janni','creator-rv-sawyer','janni','janni','Janni','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-mouthy-monsters','creator-rv-sawyer','mouthy-monsters','mouthy-monsters','Mouthy Monsters','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-path-of-the-janky','creator-rv-sawyer','path-of-the-janky','path-of-the-janky','Path of the Janky','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-ringbound','creator-rv-sawyer','ringbound','ringbound','Ringbound','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-silence-and-the-spotlight','creator-rv-sawyer','silence-and-the-spotlight','silence-and-the-spotlight','Silence and the Spotlight','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-sirrocans','creator-rv-sawyer','sirrocans','sirrocans','Sirrocans','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-spriggans','creator-rv-sawyer','spriggans','spriggans','Spriggans','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-tablecraft-primer','creator-rv-sawyer','tablecraft-primer','tablecraft-primer','Tablecraft Primer','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('listing-yojimbo','creator-rv-sawyer','yojimbo','yojimbo','Yojimbo','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
