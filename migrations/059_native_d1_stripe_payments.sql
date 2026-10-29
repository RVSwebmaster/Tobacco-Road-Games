-- Native paid orders get a bounded payment window and a durable record of when
-- Stripe Session initiation began. Legacy checkout rows remain unchanged.
ALTER TABLE orders ADD COLUMN native_payment_expires_at TEXT;
ALTER TABLE orders ADD COLUMN native_payment_started_at TEXT;

CREATE INDEX idx_orders_native_payment_expiry
  ON orders(native_order_state, native_payment_expires_at)
  WHERE catalog_source = 'native_d1';

CREATE TRIGGER validate_native_payment_window_insert
BEFORE INSERT ON orders
WHEN NEW.catalog_source = 'native_d1'
BEGIN
  SELECT RAISE(ABORT, 'native orders require a payment expiration timestamp')
  WHERE NEW.native_payment_expires_at IS NULL;
END;
