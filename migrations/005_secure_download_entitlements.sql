ALTER TABLE orders ADD COLUMN fulfillment_failure_code TEXT;
ALTER TABLE orders ADD COLUMN fulfillment_updated_at TEXT;

CREATE TABLE download_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  product_slug TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  customer_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  object_size_bytes INTEGER NOT NULL CHECK (
    typeof(object_size_bytes) = 'integer' AND object_size_bytes >= 0
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  first_downloaded_at TEXT,
  last_downloaded_at TEXT,
  successful_download_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_download_count >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  UNIQUE (order_item_id),
  UNIQUE (order_id, product_slug)
);

CREATE INDEX idx_download_entitlements_order
  ON download_entitlements (order_id, status);

CREATE TABLE download_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'success'),
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (entitlement_id) REFERENCES download_entitlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT
);

CREATE INDEX idx_download_attempts_entitlement
  ON download_attempts (entitlement_id, attempted_at);
