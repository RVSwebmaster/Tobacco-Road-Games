-- Acceptance-only forward schema overlay for the current development candidate.
-- Apply once, after confirming the required columns and indexes are absent, to
-- D1 trg-orders-acceptance (2fff6e72-4e41-47e7-b497-992dadcab3d6).
-- Source DDL: migrations 070_pdf_back_cover.sql, 071_admin_product_management.sql,
-- and the schema statements in 072_storefront_listing_visibility.sql.
-- The product-row UPDATE in migration 072 is intentionally excluded: this is
-- schema compatibility only and must not rewrite Acceptance catalog data.

ALTER TABLE marketplace_products ADD COLUMN back_cover_r2_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN generated_cover_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN generated_back_cover_key TEXT;
ALTER TABLE creator_listing_files ADD COLUMN pdf_page_count INTEGER;

ALTER TABLE marketplace_products
  ADD COLUMN managed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX idx_marketplace_products_managed_by_user
  ON marketplace_products(managed_by_user_id, publication_state, slug);

ALTER TABLE marketplace_products
  ADD COLUMN storefront_visibility TEXT NOT NULL DEFAULT 'automatic'
    CHECK (storefront_visibility IN ('automatic','listed','unlisted'));
CREATE INDEX idx_marketplace_products_storefront_visibility
  ON marketplace_products(storefront_visibility, publication_state, slug);
