ALTER TABLE marketplace_creators ADD COLUMN legal_business_name TEXT NOT NULL DEFAULT '';
ALTER TABLE marketplace_creators ADD COLUMN payout_profile_status TEXT NOT NULL DEFAULT 'not_started' CHECK (payout_profile_status IN ('not_started','pending','verified','held'));
ALTER TABLE marketplace_creators ADD COLUMN tax_document_required INTEGER NOT NULL DEFAULT 0 CHECK (tax_document_required IN (0,1));

CREATE TABLE marketplace_fee_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  percentage_basis_points INTEGER NOT NULL CHECK (percentage_basis_points BETWEEN 0 AND 10000),
  fixed_order_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fixed_order_fee_cents >= 0),
  fixed_line_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fixed_line_fee_cents >= 0),
  effective_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE creator_sale_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL, order_item_id INTEGER NOT NULL UNIQUE,
  creator_id TEXT NOT NULL, product_slug TEXT NOT NULL, product_title TEXT NOT NULL,
  unit_list_price_cents INTEGER NOT NULL, unit_price_paid_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL, discount_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL,
  fee_basis_points INTEGER NOT NULL, fixed_fee_cents INTEGER NOT NULL,
  marketplace_fee_cents INTEGER NOT NULL, creator_net_cents INTEGER NOT NULL,
  currency TEXT NOT NULL, sold_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_sale_snapshots_creator_date ON creator_sale_snapshots(creator_id,sold_at);

CREATE TABLE creator_earnings_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale_earning','refund_reversal','chargeback_reversal','manual_adjustment','payout','payout_reversal')),
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
  order_id INTEGER, order_item_id INTEGER, product_slug TEXT,
  available_at TEXT NOT NULL, payout_state TEXT NOT NULL DEFAULT 'pending' CHECK (payout_state IN ('pending','available','scheduled','paid','held')),
  reason TEXT NOT NULL, operator_actor TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  related_entry_id INTEGER, created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(related_entry_id) REFERENCES creator_earnings_ledger(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_ledger_creator_date ON creator_earnings_ledger(creator_id,created_at);
CREATE INDEX idx_creator_ledger_order ON creator_earnings_ledger(order_id,entry_type);

CREATE TABLE creator_reversal_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, order_item_id INTEGER NOT NULL,
  creator_id TEXT NOT NULL, reversal_type TEXT NOT NULL CHECK(reversal_type IN ('refund_reversal','chargeback_reversal')),
  gross_reversed_cents INTEGER NOT NULL CHECK(gross_reversed_cents > 0), creator_net_reversed_cents INTEGER NOT NULL CHECK(creator_net_reversed_cents > 0),
  currency TEXT NOT NULL, provider_event_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(provider_event_id,order_item_id), FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

CREATE TABLE creator_payouts (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL, reference TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('scheduled','paid','reversed')),
  idempotency_key TEXT NOT NULL UNIQUE, operator_actor TEXT NOT NULL, paid_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

CREATE TABLE creator_financial_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id TEXT, actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, amount_cents INTEGER, currency TEXT,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
