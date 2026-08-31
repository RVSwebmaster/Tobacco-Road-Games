CREATE TABLE marketplace_service_purchases (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, user_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('preferred_creator_fee','ad_credit_package')),
  service_sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
  payment_source TEXT NOT NULL CHECK(payment_source IN ('stripe','creator_balance')), settlement_method TEXT NOT NULL CHECK(settlement_method IN ('external_provider','internal_ledger')),
  processor_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(processor_fee_cents>=0), status TEXT NOT NULL CHECK(status IN ('settled','reversed')),
  balance_reservation_id TEXT, balance_transaction_id TEXT, stripe_checkout_session_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL, reversed_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(balance_reservation_id) REFERENCES creator_balance_reservations(id) ON DELETE RESTRICT,
  FOREIGN KEY(balance_transaction_id) REFERENCES creator_balance_transactions(id) ON DELETE RESTRICT
);
CREATE INDEX idx_service_purchases_creator_date ON marketplace_service_purchases(creator_id,created_at);

CREATE TABLE marketplace_service_revenue_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, service_purchase_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('preferred_creator_fee','ad_credit_package')),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('service_revenue','service_reversal')), amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT
);

CREATE TABLE preferred_service_charges (
  service_purchase_id TEXT PRIMARY KEY, preferred_term_id TEXT NOT NULL, payment_cadence TEXT NOT NULL CHECK(payment_cadence IN ('monthly_commitment','annual_prepaid')),
  coverage_starts_at TEXT NOT NULL, coverage_ends_at TEXT NOT NULL,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT,
  FOREIGN KEY(preferred_term_id) REFERENCES creator_preferred_terms(id) ON DELETE RESTRICT
);

ALTER TABLE creator_ad_credit_purchases ADD COLUMN service_purchase_id TEXT REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT;
ALTER TABLE creator_ad_credit_purchases ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'stripe' CHECK(payment_source IN ('stripe','creator_balance'));
ALTER TABLE creator_ad_credit_purchases ADD COLUMN settlement_method TEXT NOT NULL DEFAULT 'external_provider' CHECK(settlement_method IN ('external_provider','internal_ledger'));
