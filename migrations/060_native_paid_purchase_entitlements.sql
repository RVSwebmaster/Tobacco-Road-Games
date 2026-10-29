-- Native ownership is durable and separate from download authorization. A paid
-- product may be owned before native fulfillment and customer-library delivery
-- are activated in later reconstruction tasks.
ALTER TABLE orders ADD COLUMN native_entitlement_status TEXT
  CHECK (native_entitlement_status IS NULL OR native_entitlement_status IN ('pending','ready','failed'));
ALTER TABLE orders ADD COLUMN native_entitlement_failure_code TEXT;
ALTER TABLE orders ADD COLUMN native_entitlement_updated_at TEXT;

UPDATE orders
SET native_entitlement_status = 'pending'
WHERE catalog_source = 'native_d1' AND native_entitlement_status IS NULL;

CREATE TABLE native_product_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  purchaser_user_id TEXT,
  purchaser_email_hash_snapshot TEXT NOT NULL,
  native_product_id TEXT NOT NULL,
  product_slug_snapshot TEXT NOT NULL,
  product_title_snapshot TEXT NOT NULL,
  native_creator_id TEXT NOT NULL,
  catalog_revision_snapshot INTEGER NOT NULL CHECK (
    typeof(catalog_revision_snapshot) = 'integer' AND catalog_revision_snapshot >= 1
  ),
  version_snapshot TEXT NOT NULL,
  pricing_model_snapshot TEXT NOT NULL CHECK (pricing_model_snapshot IN ('fixed','pwyw')),
  selected_price_cents_snapshot INTEGER NOT NULL CHECK (
    typeof(selected_price_cents_snapshot) = 'integer' AND selected_price_cents_snapshot > 0
  ),
  currency_snapshot TEXT NOT NULL CHECK (length(currency_snapshot) = 3),
  entitlement_source TEXT NOT NULL CHECK (entitlement_source = 'stripe_paid'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  acquired_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchaser_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (order_item_id),
  UNIQUE (order_id, native_product_id)
);

CREATE INDEX idx_native_entitlements_user_product
  ON native_product_entitlements(purchaser_user_id, native_product_id, status);
CREATE INDEX idx_native_entitlements_email_product
  ON native_product_entitlements(purchaser_email_hash_snapshot, native_product_id, status);
CREATE INDEX idx_native_entitlements_order
  ON native_product_entitlements(order_id, status);

CREATE TRIGGER validate_native_entitlement_insert
BEFORE INSERT ON native_product_entitlements
BEGIN
  SELECT RAISE(ABORT, 'native entitlement requires an authoritatively paid native order item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = NEW.order_id
      AND oi.id = NEW.order_item_id
      AND o.catalog_source = 'native_d1'
      AND o.native_order_state = 'paid'
      AND o.payment_status = 'paid'
      AND o.payment_source = 'stripe'
      AND o.stripe_payment_intent_id IS NOT NULL
      AND oi.catalog_source = 'native_d1'
      AND oi.native_product_id = NEW.native_product_id
      AND oi.native_creator_id = NEW.native_creator_id
  );
END;

CREATE TRIGGER protect_native_entitlement_snapshot
BEFORE UPDATE ON native_product_entitlements
WHEN OLD.order_id IS NOT NEW.order_id
  OR OLD.order_item_id IS NOT NEW.order_item_id
  OR OLD.purchaser_user_id IS NOT NEW.purchaser_user_id
  OR OLD.purchaser_email_hash_snapshot IS NOT NEW.purchaser_email_hash_snapshot
  OR OLD.native_product_id IS NOT NEW.native_product_id
  OR OLD.product_slug_snapshot IS NOT NEW.product_slug_snapshot
  OR OLD.product_title_snapshot IS NOT NEW.product_title_snapshot
  OR OLD.native_creator_id IS NOT NEW.native_creator_id
  OR OLD.catalog_revision_snapshot IS NOT NEW.catalog_revision_snapshot
  OR OLD.version_snapshot IS NOT NEW.version_snapshot
  OR OLD.pricing_model_snapshot IS NOT NEW.pricing_model_snapshot
  OR OLD.selected_price_cents_snapshot IS NOT NEW.selected_price_cents_snapshot
  OR OLD.currency_snapshot IS NOT NEW.currency_snapshot
  OR OLD.entitlement_source IS NOT NEW.entitlement_source
  OR OLD.acquired_at IS NOT NEW.acquired_at
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'native entitlement purchase snapshots are immutable');
END;

CREATE TRIGGER validate_native_entitlement_state_insert
BEFORE INSERT ON orders
WHEN NEW.catalog_source = 'native_d1'
BEGIN
  SELECT RAISE(ABORT, 'native orders require a pending entitlement state')
  WHERE NEW.native_entitlement_status <> 'pending' OR NEW.native_entitlement_status IS NULL;
END;
