CREATE TABLE marketplace_service_purchases_v2 (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, user_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('preferred_creator_fee','ad_credit_package','additional_creator_identity_fee')),
  service_sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
  payment_source TEXT NOT NULL CHECK(payment_source IN ('stripe','creator_balance')), settlement_method TEXT NOT NULL CHECK(settlement_method IN ('external_provider','internal_ledger')),
  processor_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(processor_fee_cents>=0), status TEXT NOT NULL CHECK(status IN ('settled','reversed')),
  balance_reservation_id TEXT, balance_transaction_id TEXT, stripe_checkout_session_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL, reversed_at TEXT,
  provider_event_id TEXT, provider_payment_reference TEXT, processor_fee_authoritative INTEGER NOT NULL DEFAULT 0 CHECK(processor_fee_authoritative IN (0,1)), completed_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(balance_reservation_id) REFERENCES creator_balance_reservations(id) ON DELETE RESTRICT,
  FOREIGN KEY(balance_transaction_id) REFERENCES creator_balance_transactions(id) ON DELETE RESTRICT
);
INSERT INTO marketplace_service_purchases_v2 SELECT * FROM marketplace_service_purchases;

CREATE TABLE marketplace_service_revenue_ledger_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, service_purchase_id TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('preferred_creator_fee','ad_credit_package','additional_creator_identity_fee')),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('service_revenue','service_reversal')), amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases_v2(id) ON DELETE RESTRICT
);
INSERT INTO marketplace_service_revenue_ledger_v2 SELECT * FROM marketplace_service_revenue_ledger;

CREATE TABLE preferred_service_charges_v2 (
  service_purchase_id TEXT PRIMARY KEY, preferred_term_id TEXT NOT NULL, payment_cadence TEXT NOT NULL CHECK(payment_cadence IN ('monthly_commitment','annual_prepaid')),
  coverage_starts_at TEXT NOT NULL, coverage_ends_at TEXT NOT NULL,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases_v2(id) ON DELETE RESTRICT,
  FOREIGN KEY(preferred_term_id) REFERENCES creator_preferred_terms(id) ON DELETE RESTRICT
);
INSERT INTO preferred_service_charges_v2 SELECT * FROM preferred_service_charges;

CREATE TABLE creator_ad_credit_purchases_v2 (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 5, amount_cents INTEGER NOT NULL DEFAULT 500,
  currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')),
  stripe_checkout_session_id TEXT UNIQUE, checkout_url TEXT, created_at TEXT NOT NULL, paid_at TEXT,
  service_purchase_id TEXT, payment_source TEXT NOT NULL DEFAULT 'stripe' CHECK(payment_source IN ('stripe','creator_balance')),
  settlement_method TEXT NOT NULL DEFAULT 'external_provider' CHECK(settlement_method IN ('external_provider','internal_ledger')),
  initiated_by_user_id TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id),
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases_v2(id) ON DELETE RESTRICT,
  FOREIGN KEY(initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
INSERT INTO creator_ad_credit_purchases_v2 SELECT * FROM creator_ad_credit_purchases;

DROP TABLE marketplace_service_revenue_ledger;
DROP TABLE preferred_service_charges;
DROP TABLE creator_ad_credit_purchases;
DROP TABLE marketplace_service_purchases;
ALTER TABLE marketplace_service_purchases_v2 RENAME TO marketplace_service_purchases;
ALTER TABLE marketplace_service_revenue_ledger_v2 RENAME TO marketplace_service_revenue_ledger;
ALTER TABLE preferred_service_charges_v2 RENAME TO preferred_service_charges;
ALTER TABLE creator_ad_credit_purchases_v2 RENAME TO creator_ad_credit_purchases;
CREATE INDEX idx_service_purchases_creator_date ON marketplace_service_purchases(creator_id,created_at);
CREATE UNIQUE INDEX idx_service_purchase_stripe_session ON marketplace_service_purchases(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_service_purchase_provider_event ON marketplace_service_purchases(provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE creator_identity_coverage_periods (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, service_purchase_id TEXT NOT NULL UNIQUE,
  billing_plan TEXT NOT NULL CHECK(billing_plan IN ('monthly','annual_prepaid')),
  coverage_starts_at TEXT NOT NULL, coverage_ends_at TEXT NOT NULL,
  payment_source TEXT NOT NULL CHECK(payment_source IN ('stripe','creator_balance')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled','reversed')),
  renewal_state TEXT NOT NULL DEFAULT 'nonrenewing' CHECK(renewal_state IN ('nonrenewing','cancelled')),
  created_at TEXT NOT NULL, cancelled_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT
);
CREATE INDEX idx_identity_coverage_current ON creator_identity_coverage_periods(creator_id,coverage_ends_at,status);
CREATE UNIQUE INDEX idx_identity_coverage_start ON creator_identity_coverage_periods(creator_id,coverage_starts_at);

CREATE TABLE creator_identity_billing_attempts (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, user_id TEXT NOT NULL,
  billing_plan TEXT NOT NULL CHECK(billing_plan IN ('monthly','annual_prepaid')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents IN (1000,10000)), currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed','cancelled')),
  stripe_checkout_session_id TEXT UNIQUE, checkout_url TEXT, service_purchase_id TEXT,
  created_at TEXT NOT NULL, paid_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT
);
CREATE INDEX idx_identity_billing_attempt_creator ON creator_identity_billing_attempts(creator_id,created_at);
