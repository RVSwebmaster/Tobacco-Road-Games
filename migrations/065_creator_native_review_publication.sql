ALTER TABLE creator_listings
ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
CHECK (typeof(revision) = 'integer' AND revision >= 1);

CREATE TRIGGER require_creator_listing_publication_transition
BEFORE INSERT ON marketplace_products
WHEN NEW.creator_listing_id IS NOT NULL
  AND json_type(NEW.metadata_json, '$.creatorReviewRevision') IS NOT NULL
  AND NOT EXISTS (
  SELECT 1 FROM creator_listings
  WHERE id = NEW.creator_listing_id
    AND creator_id = NEW.creator_id
    AND lifecycle_state = 'submitted'
    AND publication_state = 'publishing'
    AND revision = json_extract(NEW.metadata_json, '$.creatorReviewRevision')
)
BEGIN
  SELECT RAISE(ABORT, 'creator listing publication transition is not current');
END;

