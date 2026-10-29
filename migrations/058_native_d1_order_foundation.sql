-- Native D1 orders retain immutable purchase-time identity, pricing, and private
-- fulfillment snapshots. Legacy rows keep their existing shape and behavior.
ALTER TABLE orders ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK (catalog_source IN ('legacy','native_d1'));
ALTER TABLE orders ADD COLUMN native_order_state TEXT
  CHECK (native_order_state IS NULL OR native_order_state IN (
    'pending','paid','free_acquired','canceled','failed'
  ));
ALTER TABLE orders ADD COLUMN native_prepared_at TEXT;

ALTER TABLE order_items ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK (catalog_source IN ('legacy','native_d1'));
ALTER TABLE order_items ADD COLUMN native_product_id TEXT;
ALTER TABLE order_items ADD COLUMN native_creator_id TEXT;
ALTER TABLE order_items ADD COLUMN catalog_revision INTEGER
  CHECK (catalog_revision IS NULL OR (typeof(catalog_revision) = 'integer' AND catalog_revision >= 1));
ALTER TABLE order_items ADD COLUMN pricing_model_snapshot TEXT
  CHECK (pricing_model_snapshot IS NULL OR pricing_model_snapshot IN ('fixed','free','pwyw'));
ALTER TABLE order_items ADD COLUMN selected_price_cents INTEGER
  CHECK (selected_price_cents IS NULL OR (typeof(selected_price_cents) = 'integer' AND selected_price_cents >= 0));
ALTER TABLE order_items ADD COLUMN minimum_price_cents_snapshot INTEGER
  CHECK (minimum_price_cents_snapshot IS NULL OR (typeof(minimum_price_cents_snapshot) = 'integer' AND minimum_price_cents_snapshot >= 0));
ALTER TABLE order_items ADD COLUMN suggested_price_cents_snapshot INTEGER
  CHECK (suggested_price_cents_snapshot IS NULL OR (typeof(suggested_price_cents_snapshot) = 'integer' AND suggested_price_cents_snapshot >= 0));
ALTER TABLE order_items ADD COLUMN publication_state_snapshot TEXT
  CHECK (publication_state_snapshot IS NULL OR publication_state_snapshot IN ('draft','published','paused','retired'));
ALTER TABLE order_items ADD COLUMN product_status_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN delivery_r2_key_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN delivery_filename_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN delivery_content_type_snapshot TEXT;

CREATE INDEX idx_orders_catalog_source_state
  ON orders(catalog_source, native_order_state, created_at);
CREATE INDEX idx_order_items_native_product
  ON order_items(native_product_id, order_id)
  WHERE native_product_id IS NOT NULL;
CREATE INDEX idx_order_items_native_creator
  ON order_items(native_creator_id, order_id)
  WHERE native_creator_id IS NOT NULL;

CREATE TRIGGER validate_native_order_insert
BEFORE INSERT ON orders
WHEN NEW.catalog_source = 'native_d1'
BEGIN
  SELECT RAISE(ABORT, 'native orders require a native state and preparation timestamp')
  WHERE NEW.native_order_state IS NULL OR NEW.native_prepared_at IS NULL;
END;

CREATE TRIGGER validate_native_order_item_insert
BEFORE INSERT ON order_items
WHEN NEW.catalog_source = 'native_d1'
BEGIN
  SELECT RAISE(ABORT, 'native order item snapshot is incomplete')
  WHERE NEW.native_product_id IS NULL
    OR NEW.native_creator_id IS NULL
    OR NEW.catalog_revision IS NULL
    OR NEW.pricing_model_snapshot IS NULL
    OR NEW.selected_price_cents IS NULL
    OR NEW.publication_state_snapshot IS NULL
    OR NEW.product_status_snapshot IS NULL
    OR NEW.delivery_r2_key_snapshot IS NULL
    OR NEW.delivery_filename_snapshot IS NULL
    OR NEW.delivery_content_type_snapshot IS NULL;
  SELECT RAISE(ABORT, 'native selected price must equal the effective unit price')
  WHERE NEW.selected_price_cents <> NEW.effective_unit_price_cents;
  SELECT RAISE(ABORT, 'native order preparation requires a published product')
  WHERE NEW.publication_state_snapshot <> 'published';
END;

CREATE TRIGGER protect_native_order_item_snapshot
BEFORE UPDATE ON order_items
WHEN OLD.catalog_source = 'native_d1'
BEGIN
  SELECT RAISE(ABORT, 'native order item snapshots are immutable');
END;
