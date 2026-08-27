ALTER TABLE marketplace_creators ADD COLUMN owner_catalog_override INTEGER NOT NULL DEFAULT 0 CHECK(owner_catalog_override IN (0,1));
UPDATE marketplace_creators SET owner_catalog_override=1 WHERE id='creator-rv-sawyer';

ALTER TABLE creator_listings ADD COLUMN first_published_at TEXT;
ALTER TABLE creator_listings ADD COLUMN pricing_model TEXT NOT NULL DEFAULT 'fixed' CHECK(pricing_model IN ('fixed','free','pwyw'));
ALTER TABLE creator_listings ADD COLUMN suggested_price_cents INTEGER CHECK(suggested_price_cents IS NULL OR suggested_price_cents >= 0);
UPDATE creator_listings SET first_published_at=published_at WHERE published_at IS NOT NULL;
CREATE TRIGGER protect_creator_listing_first_publication
BEFORE UPDATE OF first_published_at ON creator_listings
WHEN OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS NOT OLD.first_published_at
BEGIN SELECT RAISE(ABORT,'first publication timestamp is immutable'); END;
CREATE TABLE creator_first_publication_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, previous_timestamp TEXT NOT NULL, corrected_timestamp TEXT NOT NULL,
  reason TEXT NOT NULL, operator_actor TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT
);

CREATE TABLE creator_preferred_terms (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, payment_cadence TEXT NOT NULL CHECK(payment_cadence IN ('monthly_commitment','annual_prepaid')),
  price_cents INTEGER NOT NULL CHECK(price_cents IN (2000,20000)), term_started_at TEXT NOT NULL, term_ends_at TEXT NOT NULL,
  renewal_state TEXT NOT NULL DEFAULT 'renews' CHECK(renewal_state IN ('renews','cancelled')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_preferred_terms_creator_dates ON creator_preferred_terms(creator_id,term_started_at,term_ends_at,status);

ALTER TABLE creator_sale_snapshots ADD COLUMN product_identity_id TEXT;
ALTER TABLE creator_sale_snapshots ADD COLUMN policy_reason TEXT NOT NULL DEFAULT 'legacy';
