CREATE TABLE creator_payout_profiles (
  creator_id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'manual' CHECK(provider IN ('manual','stripe_connect','paypal','ach_provider')),
  provider_account_reference TEXT NOT NULL DEFAULT '', onboarding_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onboarding_status IN ('not_started','pending','complete','restricted')),
  payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(payouts_enabled IN (0,1)), verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','pending','verified','restricted')),
  country TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD', operator_hold_reason TEXT NOT NULL DEFAULT '', status_updated_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE
);

CREATE TABLE provider_financial_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL, order_id INTEGER, payment_intent_id TEXT, provider_object_id TEXT,
  amount_cents INTEGER, currency TEXT, accounting_action TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL,
  UNIQUE(provider,provider_event_id), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT
);

CREATE TABLE creator_dispute_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dispute_id TEXT NOT NULL, order_id INTEGER NOT NULL, creator_id TEXT NOT NULL,
  allocated_gross_cents INTEGER NOT NULL CHECK(allocated_gross_cents >= 0), currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('held','released','lost')), provider_event_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(dispute_id,creator_id), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_disputes_creator_status ON creator_dispute_allocations(creator_id,status);

INSERT OR IGNORE INTO creator_payout_profiles(creator_id,status_updated_at)
SELECT id,CURRENT_TIMESTAMP FROM marketplace_creators;
