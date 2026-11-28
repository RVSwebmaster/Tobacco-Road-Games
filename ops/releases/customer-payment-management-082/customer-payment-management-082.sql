-- Keep Customer purchase payment methods separate from Creator billing references.
-- Stripe remains authoritative for cards and billing addresses; TRG stores IDs only.
CREATE TABLE IF NOT EXISTS customer_stripe_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_reference TEXT NOT NULL UNIQUE CHECK(substr(stripe_customer_reference,1,4)='cus_'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_payment_portal_configurations (
  stripe_mode TEXT PRIMARY KEY CHECK(stripe_mode IN ('test','live')),
  configuration_reference TEXT NOT NULL UNIQUE CHECK(substr(configuration_reference,1,4)='bpc_'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
