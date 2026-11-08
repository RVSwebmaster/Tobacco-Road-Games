-- Retain the authenticated account that created and manages a native D1/R2
-- publication. Historical records remain nullable because their managing
-- account cannot be reconstructed reliably from author or publisher text.
ALTER TABLE marketplace_products
  ADD COLUMN managed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX idx_marketplace_products_managed_by_user
  ON marketplace_products(managed_by_user_id, publication_state, slug);
