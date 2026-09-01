CREATE TABLE preferred_billing_commitments (
  id TEXT PRIMARY KEY,
  preferred_term_id TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK(plan_type IN ('monthly_commitment','annual_prepaid')),
  commitment_starts_at TEXT NOT NULL,
  commitment_ends_at TEXT NOT NULL,
  paid_through_at TEXT,
  normal_payment_source TEXT NOT NULL CHECK(normal_payment_source IN ('stripe','creator_balance')),
  billing_state TEXT NOT NULL DEFAULT 'pending' CHECK(billing_state IN ('pending','current','remediation','completed','suspended')),
  renewal_state TEXT NOT NULL DEFAULT 'renewal_decision_required' CHECK(renewal_state IN ('renewal_decision_required','do_not_renew','renewal_authorized')),
  grace_days INTEGER NOT NULL DEFAULT 7 CHECK(grace_days BETWEEN 1 AND 30),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(preferred_term_id) REFERENCES creator_preferred_terms(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_preferred_commitment_creator ON preferred_billing_commitments(creator_id,commitment_ends_at,billing_state);

CREATE TABLE preferred_billing_installments (
  id TEXT PRIMARY KEY,
  commitment_id TEXT NOT NULL,
  installment_number INTEGER NOT NULL CHECK(installment_number BETWEEN 1 AND 12),
  amount_cents INTEGER NOT NULL CHECK(amount_cents=2000),
  due_at TEXT NOT NULL,
  coverage_starts_at TEXT NOT NULL,
  coverage_ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','paid','failed','past_due','cancelled')),
  payment_source TEXT CHECK(payment_source IS NULL OR payment_source IN ('stripe','creator_balance')),
  service_purchase_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  provider_event_id TEXT UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TEXT,
  next_retry_at TEXT,
  grace_ends_at TEXT NOT NULL,
  paid_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(commitment_id,installment_number),
  FOREIGN KEY(commitment_id) REFERENCES preferred_billing_commitments(id) ON DELETE RESTRICT,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT
);
CREATE INDEX idx_preferred_installments_due ON preferred_billing_installments(status,due_at,next_retry_at);

CREATE TABLE preferred_external_billing_attempts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK(plan_type IN ('annual_prepaid')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents=20000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed','cancelled')),
  stripe_checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  service_purchase_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(service_purchase_id) REFERENCES marketplace_service_purchases(id) ON DELETE RESTRICT
);

ALTER TABLE preferred_service_charges ADD COLUMN commitment_id TEXT REFERENCES preferred_billing_commitments(id) ON DELETE RESTRICT;
ALTER TABLE preferred_service_charges ADD COLUMN installment_id TEXT REFERENCES preferred_billing_installments(id) ON DELETE RESTRICT;
ALTER TABLE preferred_service_charges ADD COLUMN external_attempt_id TEXT REFERENCES preferred_external_billing_attempts(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX idx_preferred_charge_installment ON preferred_service_charges(installment_id) WHERE installment_id IS NOT NULL;

CREATE TABLE preferred_billing_provider_attempts (
  id TEXT PRIMARY KEY,
  installment_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  provider_event_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('requested','succeeded','failed','requires_action')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(installment_id,attempt_number),
  UNIQUE(stripe_payment_intent_id),
  UNIQUE(provider_event_id),
  FOREIGN KEY(installment_id) REFERENCES preferred_billing_installments(id) ON DELETE RESTRICT
);
