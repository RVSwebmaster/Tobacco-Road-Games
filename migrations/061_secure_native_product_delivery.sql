-- Native ownership uses an opaque signed download reference and keeps delivery
-- audit state separate from legacy download_entitlements.
ALTER TABLE native_product_entitlements ADD COLUMN download_reference TEXT;
ALTER TABLE native_product_entitlements ADD COLUMN first_downloaded_at TEXT;
ALTER TABLE native_product_entitlements ADD COLUMN last_downloaded_at TEXT;
ALTER TABLE native_product_entitlements ADD COLUMN successful_download_count INTEGER NOT NULL DEFAULT 0
  CHECK (successful_download_count >= 0);

UPDATE native_product_entitlements
SET download_reference = lower(hex(randomblob(16)))
WHERE download_reference IS NULL;

CREATE UNIQUE INDEX idx_native_entitlements_download_reference
  ON native_product_entitlements(download_reference)
  WHERE download_reference IS NOT NULL;

CREATE TABLE native_download_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'success'),
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (entitlement_id) REFERENCES native_product_entitlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT
);

CREATE INDEX idx_native_download_attempts_entitlement
  ON native_download_attempts(entitlement_id, attempted_at);
