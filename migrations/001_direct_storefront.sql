PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  customer_email TEXT NOT NULL,
  customer_email_normalized TEXT NOT NULL,
  customer_email_hash TEXT NOT NULL,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  subtotal_cents INTEGER NOT NULL CHECK (typeof(subtotal_cents) = 'integer' AND subtotal_cents >= 0),
  included_tax_cents INTEGER CHECK (included_tax_cents IS NULL OR (typeof(included_tax_cents) = 'integer' AND included_tax_cents >= 0)),
  total_cents INTEGER NOT NULL CHECK (typeof(total_cents) = 'integer' AND total_cents >= 0),
  processor_fee_cents INTEGER CHECK (processor_fee_cents IS NULL OR typeof(processor_fee_cents) = 'integer'),
  net_proceeds_cents INTEGER CHECK (net_proceeds_cents IS NULL OR typeof(net_proceeds_cents) = 'integer'),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'expired', 'refunded', 'disputed')),
  fulfillment_status TEXT NOT NULL CHECK (fulfillment_status IN ('pending', 'ready', 'fulfilled', 'failed', 'canceled')),
  email_status TEXT NOT NULL CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  created_at TEXT NOT NULL,
  paid_at TEXT,
  completed_at TEXT,
  refunded_at TEXT,
  disputed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_email_normalized
  ON orders (customer_email_normalized);

CREATE INDEX IF NOT EXISTS idx_orders_customer_email_hash
  ON orders (customer_email_hash);

CREATE INDEX IF NOT EXISTS idx_orders_payment_status
  ON orders (payment_status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_slug TEXT NOT NULL,
  product_title_snapshot TEXT NOT NULL,
  primary_author_slug TEXT NOT NULL,
  author_slugs_json TEXT NOT NULL CHECK (json_valid(author_slugs_json)),
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity = 1),
  list_price_cents INTEGER NOT NULL CHECK (typeof(list_price_cents) = 'integer' AND list_price_cents >= 0),
  effective_unit_price_cents INTEGER NOT NULL CHECK (typeof(effective_unit_price_cents) = 'integer' AND effective_unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (typeof(line_total_cents) = 'integer' AND line_total_cents >= 0 AND line_total_cents = effective_unit_price_cents),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  version_snapshot TEXT NOT NULL,
  last_updated_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE (order_id, product_slug)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('pending', 'processed', 'failed', 'ignored')),
  internal_order_id INTEGER,
  error_text TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (internal_order_id) REFERENCES orders(id) ON DELETE SET NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_internal_order_id
  ON webhook_events (internal_order_id);
