-- Extend native ownership to zero-value acquisitions while preserving all paid
-- entitlement and download audit history.
DROP TRIGGER validate_native_entitlement_insert;
DROP TRIGGER protect_native_entitlement_snapshot;

CREATE TABLE native_product_entitlements_v2 (
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
  pricing_model_snapshot TEXT NOT NULL CHECK (pricing_model_snapshot IN ('fixed','free','pwyw')),
  selected_price_cents_snapshot INTEGER NOT NULL CHECK (
    typeof(selected_price_cents_snapshot) = 'integer' AND selected_price_cents_snapshot >= 0
  ),
  currency_snapshot TEXT NOT NULL CHECK (length(currency_snapshot) = 3),
  entitlement_source TEXT NOT NULL CHECK (entitlement_source IN ('stripe_paid','native_free')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  acquired_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  download_reference TEXT,
  first_downloaded_at TEXT,
  last_downloaded_at TEXT,
  successful_download_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_download_count >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchaser_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (order_item_id),
  UNIQUE (order_id, native_product_id)
);

INSERT INTO native_product_entitlements_v2(
  id,order_id,order_item_id,purchaser_user_id,purchaser_email_hash_snapshot,
  native_product_id,product_slug_snapshot,product_title_snapshot,native_creator_id,
  catalog_revision_snapshot,version_snapshot,pricing_model_snapshot,
  selected_price_cents_snapshot,currency_snapshot,entitlement_source,status,
  acquired_at,created_at,revoked_at,download_reference,first_downloaded_at,
  last_downloaded_at,successful_download_count
)
SELECT id,order_id,order_item_id,purchaser_user_id,purchaser_email_hash_snapshot,
  native_product_id,product_slug_snapshot,product_title_snapshot,native_creator_id,
  catalog_revision_snapshot,version_snapshot,pricing_model_snapshot,
  selected_price_cents_snapshot,currency_snapshot,entitlement_source,status,
  acquired_at,created_at,revoked_at,download_reference,first_downloaded_at,
  last_downloaded_at,successful_download_count
FROM native_product_entitlements;

CREATE TABLE native_download_attempts_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'success'),
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (entitlement_id) REFERENCES native_product_entitlements_v2(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT
);

INSERT INTO native_download_attempts_v2(id,entitlement_id,order_id,order_item_id,outcome,attempted_at)
SELECT id,entitlement_id,order_id,order_item_id,outcome,attempted_at
FROM native_download_attempts;

DROP TABLE native_download_attempts;
DROP TABLE native_product_entitlements;
ALTER TABLE native_product_entitlements_v2 RENAME TO native_product_entitlements;
ALTER TABLE native_download_attempts_v2 RENAME TO native_download_attempts;

CREATE INDEX idx_native_entitlements_user_product
  ON native_product_entitlements(purchaser_user_id, native_product_id, status);
CREATE UNIQUE INDEX idx_native_entitlements_active_user_free_product
  ON native_product_entitlements(purchaser_user_id, native_product_id)
  WHERE purchaser_user_id IS NOT NULL AND status = 'active'
    AND entitlement_source = 'native_free';
CREATE INDEX idx_native_entitlements_email_product
  ON native_product_entitlements(purchaser_email_hash_snapshot, native_product_id, status);
CREATE INDEX idx_native_entitlements_order
  ON native_product_entitlements(order_id, status);
CREATE UNIQUE INDEX idx_native_entitlements_download_reference
  ON native_product_entitlements(download_reference)
  WHERE download_reference IS NOT NULL;
CREATE INDEX idx_native_download_attempts_entitlement
  ON native_download_attempts(entitlement_id, attempted_at);

CREATE TRIGGER validate_native_entitlement_insert
BEFORE INSERT ON native_product_entitlements
BEGIN
  SELECT RAISE(ABORT, 'native entitlement requires an authoritative native acquisition')
  WHERE NOT EXISTS (
    SELECT 1
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = NEW.order_id
      AND oi.id = NEW.order_item_id
      AND o.catalog_source = 'native_d1'
      AND o.payment_status = 'paid'
      AND oi.catalog_source = 'native_d1'
      AND oi.native_product_id = NEW.native_product_id
      AND oi.native_creator_id = NEW.native_creator_id
      AND (
        (NEW.entitlement_source = 'stripe_paid'
          AND o.native_order_state = 'paid'
          AND o.payment_source = 'stripe'
          AND o.settlement_method = 'external_provider'
          AND o.stripe_payment_intent_id IS NOT NULL
          AND oi.pricing_model_snapshot IN ('fixed','pwyw')
          AND oi.selected_price_cents > 0)
        OR
        (NEW.entitlement_source = 'native_free'
          AND o.native_order_state = 'free_acquired'
          AND o.payment_source = 'none'
          AND o.settlement_method = 'no_payment'
          AND o.stripe_checkout_session_id IS NULL
          AND o.stripe_payment_intent_id IS NULL
          AND oi.pricing_model_snapshot IN ('fixed','free','pwyw')
          AND oi.selected_price_cents = 0)
      )
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
