ALTER TABLE creator_listings ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'not_approved' CHECK (publication_state IN ('not_approved','approved','waiting_for_files','ready','publishing','published','failed','paused'));
ALTER TABLE creator_listings ADD COLUMN public_product_slug TEXT;
ALTER TABLE creator_listings ADD COLUMN publication_errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(publication_errors_json));
ALTER TABLE creator_listings ADD COLUMN published_at TEXT;

CREATE TABLE creator_listing_files (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('product','cover','preview','supporting')),
  original_filename TEXT NOT NULL, normalized_filename TEXT NOT NULL, content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0), quarantine_key TEXT NOT NULL UNIQUE,
  validation_state TEXT NOT NULL DEFAULT 'uploaded' CHECK (validation_state IN ('uploaded','validating','accepted','rejected','superseded')),
  validation_message TEXT NOT NULL DEFAULT '', delivery_object_key TEXT,
  uploaded_at TEXT NOT NULL, validated_at TEXT,
  FOREIGN KEY (listing_id) REFERENCES creator_listings(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_listing_files_listing ON creator_listing_files (listing_id,validation_state,purpose);

CREATE TABLE creator_publication_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('creator','operator','system')), actor_id TEXT NOT NULL,
  action TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)), created_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT,
  FOREIGN KEY (creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_publication_audit_listing ON creator_publication_audit (listing_id,created_at);

ALTER TABLE creator_bundles ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'not_approved' CHECK (publication_state IN ('not_approved','approved','published','rejected'));
ALTER TABLE creator_bundles ADD COLUMN public_bundle_slug TEXT;
CREATE TABLE creator_bundle_publication_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,bundle_id TEXT NOT NULL,creator_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),created_at TEXT NOT NULL,FOREIGN KEY(bundle_id) REFERENCES creator_bundles(id) ON DELETE RESTRICT,FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT);
