ALTER TABLE creator_listings ADD COLUMN owner_review_hold INTEGER NOT NULL DEFAULT 0 CHECK(owner_review_hold IN (0,1));
ALTER TABLE creator_listings ADD COLUMN owner_review_hold_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE creator_listings ADD COLUMN owner_review_hold_started_at TEXT;
ALTER TABLE creator_listings ADD COLUMN owner_review_hold_corrective_action_expected INTEGER NOT NULL DEFAULT 0 CHECK(owner_review_hold_corrective_action_expected IN (0,1));

CREATE INDEX idx_creator_listings_owner_review_hold
  ON creator_listings(owner_review_hold, creator_id, updated_at);

CREATE TRIGGER creator_listing_review_hold_required_fields_insert
BEFORE INSERT ON creator_listings
WHEN NEW.owner_review_hold=1 AND (length(trim(NEW.owner_review_hold_reason))=0 OR NEW.owner_review_hold_started_at IS NULL)
BEGIN
  SELECT RAISE(ABORT,'Owner review hold requires a reason and start timestamp.');
END;

CREATE TRIGGER creator_listing_review_hold_required_fields_update
BEFORE UPDATE OF owner_review_hold,owner_review_hold_reason,owner_review_hold_started_at ON creator_listings
WHEN NEW.owner_review_hold=1 AND (length(trim(NEW.owner_review_hold_reason))=0 OR NEW.owner_review_hold_started_at IS NULL)
BEGIN
  SELECT RAISE(ABORT,'Owner review hold requires a reason and start timestamp.');
END;
