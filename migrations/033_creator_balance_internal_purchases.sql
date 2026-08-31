ALTER TABLE orders ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'stripe' CHECK(payment_source IN ('stripe','none','creator_balance'));
ALTER TABLE orders ADD COLUMN settlement_method TEXT NOT NULL DEFAULT 'external_provider' CHECK(settlement_method IN ('external_provider','no_payment','internal_ledger'));

CREATE TABLE creator_balance_reservations (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, user_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('product_purchase','marketplace_service')), checkout_attempt_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')), order_public_id TEXT, created_at TEXT NOT NULL, resolved_at TEXT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_balance_reservations_active ON creator_balance_reservations(creator_id,currency,state);

CREATE TABLE creator_balance_transactions (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, user_id TEXT NOT NULL, transaction_type TEXT NOT NULL CHECK(transaction_type IN ('purchase_debit','refund_credit','service_debit','operator_correction')),
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, order_id INTEGER, reservation_id TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT, FOREIGN KEY(reservation_id) REFERENCES creator_balance_reservations(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_balance_transactions_creator ON creator_balance_transactions(creator_id,currency,created_at);

CREATE TABLE creator_balance_settlements (
  id TEXT PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE, order_public_id TEXT NOT NULL UNIQUE, buyer_creator_id TEXT NOT NULL, buyer_user_id TEXT NOT NULL,
  gross_cents INTEGER NOT NULL CHECK(gross_cents>0), marketplace_commission_cents INTEGER NOT NULL CHECK(marketplace_commission_cents>=0), seller_net_cents INTEGER NOT NULL CHECK(seller_net_cents>=0),
  currency TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('settled','refunded')), debit_transaction_id TEXT NOT NULL,
  refund_transaction_id TEXT, settled_at TEXT NOT NULL, refunded_at TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT, FOREIGN KEY(buyer_creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(buyer_user_id) REFERENCES users(id) ON DELETE RESTRICT, FOREIGN KEY(debit_transaction_id) REFERENCES creator_balance_transactions(id) ON DELETE RESTRICT,
  FOREIGN KEY(refund_transaction_id) REFERENCES creator_balance_transactions(id) ON DELETE RESTRICT
);

CREATE TABLE marketplace_internal_commission_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, order_item_id INTEGER, entry_type TEXT NOT NULL CHECK(entry_type IN ('commission','commission_reversal')),
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT, FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT
);

CREATE TRIGGER protect_creator_balance_reservation
BEFORE INSERT ON creator_balance_reservations WHEN NEW.state='reserved'
BEGIN
  SELECT RAISE(ABORT,'insufficient available Creator Balance') WHERE (
    COALESCE((SELECT SUM(amount_cents) FROM creator_earnings_ledger WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND payout_state<>'held' AND available_at<=NEW.created_at),0)
    + COALESCE((SELECT SUM(amount_cents) FROM creator_balance_transactions WHERE creator_id=NEW.creator_id AND currency=NEW.currency),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_payout_reservations WHERE creator_id=NEW.creator_id AND status='reserved'),0)
    - COALESCE((SELECT SUM(amount_cents) FROM creator_balance_reservations WHERE creator_id=NEW.creator_id AND currency=NEW.currency AND state='reserved'),0)
  ) < NEW.amount_cents;
END;

CREATE TABLE creator_balance_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT NOT NULL CHECK(actor_type IN ('customer','operator','system')), actor_id TEXT NOT NULL,
  action TEXT NOT NULL, creator_id TEXT NOT NULL, order_public_id TEXT, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
