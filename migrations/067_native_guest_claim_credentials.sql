-- Native guest claim links expire and become bound to the verified account
-- that successfully claims the paid order. Existing legacy delivery links
-- retain their current behavior because these fields remain nullable.
ALTER TABLE order_access_credentials ADD COLUMN expires_at TEXT;
ALTER TABLE order_access_credentials ADD COLUMN consumed_at TEXT;
ALTER TABLE order_access_credentials ADD COLUMN consumed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX idx_order_access_expiration
  ON order_access_credentials(status, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TRIGGER protect_order_access_consumption
BEFORE UPDATE OF consumed_at, consumed_by_user_id ON order_access_credentials
WHEN OLD.consumed_at IS NOT NEW.consumed_at
  OR OLD.consumed_by_user_id IS NOT NEW.consumed_by_user_id
BEGIN
  SELECT RAISE(ABORT, 'order access credential consumption is immutable')
  WHERE OLD.consumed_at IS NOT NULL
    OR OLD.consumed_by_user_id IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.consumed_by_user_id IS NULL;
END;
