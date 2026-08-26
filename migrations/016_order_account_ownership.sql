ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_user_paid_created
  ON orders (user_id, payment_status, created_at);

PRAGMA optimize;
