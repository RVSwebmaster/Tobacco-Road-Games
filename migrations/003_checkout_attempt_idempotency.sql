ALTER TABLE orders ADD COLUMN checkout_attempt_id TEXT;
ALTER TABLE orders ADD COLUMN checkout_request_hash TEXT CHECK (
  checkout_request_hash IS NULL OR length(checkout_request_hash) = 64
);
ALTER TABLE orders ADD COLUMN checkout_session_status TEXT NOT NULL DEFAULT 'legacy' CHECK (
  checkout_session_status IN (
    'legacy',
    'creating',
    'retryable',
    'active',
    'failed_terminal',
    'synthetic_failure'
  )
);
ALTER TABLE orders ADD COLUMN checkout_failure_code TEXT;
ALTER TABLE orders ADD COLUMN stripe_checkout_session_url TEXT;
ALTER TABLE orders ADD COLUMN checkout_updated_at TEXT;

CREATE UNIQUE INDEX idx_orders_checkout_attempt_id
  ON orders (checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;

UPDATE orders
SET checkout_session_status = 'active',
    checkout_updated_at = COALESCE(checkout_updated_at, created_at)
WHERE stripe_checkout_session_id IS NOT NULL;
