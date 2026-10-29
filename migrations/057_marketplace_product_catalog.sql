-- Authoritative product records. Existing order items and entitlements retain their
-- sale-time slug, title, price, and R2 delivery snapshots without new foreign keys.
CREATE TABLE marketplace_products (
  id TEXT NOT NULL PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'
      AND length(slug) BETWEEN 1 AND 160 AND substr(slug, 1, 1) <> '-'
      AND substr(slug, -1) <> '-'),
  creator_id TEXT NOT NULL REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  creator_listing_id TEXT UNIQUE REFERENCES creator_listings(id) ON DELETE RESTRICT,
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_state IN ('draft','published','paused','retired')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  subtitle TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  long_description TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  game_system TEXT NOT NULL DEFAULT '',
  product_line TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'digital'
    CHECK (media_type IN ('digital','physical','hybrid')),
  status TEXT NOT NULL CHECK (status IN (
    'available-direct','coming-soon','free-download','legacy-edition',
    'legacy-not-for-sale','pay-what-you-want','preview-available',
    'preview-only','revised-edition-pending','retired')),
  buy_mode TEXT NOT NULL CHECK (buy_mode IN (
    'available-direct','cart','coming-soon','fixed-price','free-download',
    'manual-invoice','pay-what-you-want','preview-only','retired')),
  buy_url TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (length(currency) = 3 AND currency = upper(currency)
      AND currency NOT GLOB '*[^A-Z]*'),
  pricing_model TEXT NOT NULL DEFAULT 'fixed'
    CHECK (pricing_model IN ('fixed','free','pwyw')),
  price_cents INTEGER NOT NULL
    CHECK (typeof(price_cents) = 'integer' AND price_cents >= 0),
  suggested_price_cents INTEGER
    CHECK (suggested_price_cents IS NULL OR
      (typeof(suggested_price_cents) = 'integer' AND suggested_price_cents >= 0)),
  minimum_price_cents INTEGER
    CHECK (minimum_price_cents IS NULL OR
      (typeof(minimum_price_cents) = 'integer' AND minimum_price_cents >= 0)),
  sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sale_enabled IN (0,1)),
  sale_price_cents INTEGER
    CHECK (sale_price_cents IS NULL OR
      (typeof(sale_price_cents) = 'integer' AND sale_price_cents >= 0)),
  sale_start TEXT,
  sale_end TEXT,
  cover_r2_key TEXT,
  preview_r2_key TEXT,
  thumbnail_r2_key TEXT,
  delivery_r2_key TEXT,
  delivery_filename TEXT,
  delivery_content_type TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  CHECK (
    (pricing_model = 'pwyw' AND suggested_price_cents IS NOT NULL
      AND minimum_price_cents IS NOT NULL
      AND suggested_price_cents >= minimum_price_cents)
    OR (pricing_model <> 'pwyw' AND suggested_price_cents IS NULL
      AND minimum_price_cents IS NULL)
  ),
  CHECK (pricing_model <> 'free' OR price_cents = 0),
  CHECK (pricing_model <> 'fixed' OR buy_mode <> 'cart' OR price_cents > 0),
  CHECK (sale_enabled = 0 OR
    (sale_price_cents IS NOT NULL AND sale_price_cents < price_cents)),
  CHECK (delivery_r2_key IS NULL OR
    (delivery_filename IS NOT NULL AND delivery_content_type IS NOT NULL
      AND length(trim(delivery_filename)) > 0
      AND length(trim(delivery_content_type)) > 0))
);

CREATE INDEX idx_marketplace_products_creator_state_slug
  ON marketplace_products(creator_id, publication_state, slug);
CREATE INDEX idx_marketplace_products_state_status_slug
  ON marketplace_products(publication_state, status, slug);

CREATE TRIGGER protect_marketplace_product_identity
BEFORE UPDATE OF id, slug, creator_id ON marketplace_products
WHEN NEW.id IS NOT OLD.id OR NEW.slug IS NOT OLD.slug
  OR NEW.creator_id IS NOT OLD.creator_id
BEGIN
  SELECT RAISE(ABORT, 'product identity, slug, and creator are immutable');
END;

CREATE TRIGGER protect_marketplace_product_history
BEFORE DELETE ON marketplace_products
WHEN OLD.publication_state <> 'draft'
  OR EXISTS (SELECT 1 FROM order_items WHERE product_slug = OLD.slug)
  OR EXISTS (SELECT 1 FROM download_entitlements WHERE product_slug = OLD.slug)
  OR EXISTS (SELECT 1 FROM creator_sale_snapshots WHERE product_slug = OLD.slug)
BEGIN
  SELECT RAISE(ABORT, 'retire products instead of deleting them');
END;

CREATE TRIGGER protect_marketplace_product_listing_identity
BEFORE UPDATE OF creator_listing_id ON marketplace_products
WHEN OLD.creator_listing_id IS NOT NULL
  AND NEW.creator_listing_id IS NOT OLD.creator_listing_id
BEGIN
  SELECT RAISE(ABORT, 'linked creator listing is immutable');
END;

CREATE TRIGGER check_marketplace_product_listing_owner_insert
BEFORE INSERT ON marketplace_products
WHEN NEW.creator_listing_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM creator_listings
  WHERE id = NEW.creator_listing_id AND creator_id <> NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'product and creator listing must have the same owner');
END;

CREATE TRIGGER check_marketplace_product_listing_owner_update
BEFORE UPDATE OF creator_listing_id ON marketplace_products
WHEN NEW.creator_listing_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM creator_listings
  WHERE id = NEW.creator_listing_id AND creator_id <> NEW.creator_id
)
BEGIN
  SELECT RAISE(ABORT, 'product and creator listing must have the same owner');
END;
