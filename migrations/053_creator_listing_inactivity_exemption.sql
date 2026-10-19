ALTER TABLE creator_listings
ADD COLUMN inactivity_exemption_kind TEXT NOT NULL DEFAULT 'none'
CHECK(inactivity_exemption_kind IN ('none','trg_house'));
