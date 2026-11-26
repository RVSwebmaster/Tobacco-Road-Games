-- Creator Profile presentation is independent of marketplace listing status.
CREATE TABLE creator_profile_shelf_selections (
  creator_id TEXT NOT NULL REFERENCES marketplace_creators(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position>=0),
  selected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(creator_id,product_id),
  UNIQUE(creator_id,position)
);

CREATE INDEX idx_creator_profile_shelf_creator_position
  ON creator_profile_shelf_selections(creator_id,position,product_id);

CREATE TRIGGER creator_profile_shelf_owner_insert
BEFORE INSERT ON creator_profile_shelf_selections
WHEN NOT EXISTS (
  SELECT 1 FROM marketplace_products p
  WHERE p.id=NEW.product_id AND p.creator_id=NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT,'profile shelf product belongs to another Creator');
END;

CREATE TRIGGER creator_profile_shelf_capacity_insert
BEFORE INSERT ON creator_profile_shelf_selections
WHEN (SELECT COUNT(*) FROM creator_profile_shelf_selections
      WHERE creator_id=NEW.creator_id) >=
  CASE COALESCE((SELECT capacity_category FROM creator_effective_capacity_categories
                 WHERE creator_id=NEW.creator_id),'standard')
    WHEN 'admin' THEN 2147483647
    WHEN 'owner' THEN 14
    WHEN 'founding25' THEN 12
    WHEN 'premier' THEN 12
    ELSE 6
  END
BEGIN
  SELECT RAISE(ABORT,'creator profile shelf capacity exceeded');
END;

CREATE TRIGGER creator_profile_shelf_identity_immutable
BEFORE UPDATE OF creator_id,product_id ON creator_profile_shelf_selections
WHEN NEW.creator_id IS NOT OLD.creator_id OR NEW.product_id IS NOT OLD.product_id
BEGIN
  SELECT RAISE(ABORT,'profile shelf identity is immutable');
END;
