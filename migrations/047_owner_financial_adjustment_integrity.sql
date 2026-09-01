CREATE VIEW creator_signed_financial_totals AS SELECT c.id creator_id,COALESCE((SELECT SUM(l.amount_cents) FROM creator_earnings_ledger l WHERE l.creator_id=c.id AND l.currency='USD'),0)+COALESCE((SELECT SUM(t.amount_cents) FROM creator_balance_transactions t WHERE t.creator_id=c.id AND t.currency='USD'),0) signed_total_cents FROM marketplace_creators c;
CREATE VIEW trg_signed_revenue_total AS SELECT COALESCE((SELECT SUM(s.marketplace_fee_cents) FROM creator_sale_snapshots s JOIN orders o ON o.id=s.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE b.id IS NULL),0)-COALESCE((SELECT SUM(r.gross_reversed_cents-r.creator_net_reversed_cents) FROM creator_reversal_snapshots r JOIN orders o ON o.id=r.order_id LEFT JOIN creator_balance_settlements b ON b.order_id=o.id WHERE b.id IS NULL),0)+COALESCE((SELECT SUM(amount_cents) FROM marketplace_internal_commission_ledger),0)+COALESCE((SELECT SUM(amount_cents) FROM marketplace_service_revenue_ledger),0)-COALESCE((SELECT SUM(processor_fee_cents) FROM orders),0)-COALESCE((SELECT SUM(CASE WHEN p.processor_fee_authoritative=1 THEN p.processor_fee_cents ELSE 0 END) FROM marketplace_service_revenue_ledger l JOIN marketplace_service_purchases p ON p.id=l.service_purchase_id),0)-COALESCE((SELECT SUM(actual_provider_cost_cents) FROM marketplace_provider_cost_allocations WHERE responsibility='marketplace'),0)+COALESCE((SELECT SUM(delta_cents) FROM trg_revenue_adjustments),0) signed_total_cents;
CREATE TABLE owner_financial_adjustment_requests(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('creator_funds','trg_revenue')),creator_id TEXT NOT NULL,expected_total_cents INTEGER NOT NULL,desired_total_cents INTEGER NOT NULL,delta_cents INTEGER NOT NULL CHECK(desired_total_cents-expected_total_cents=delta_cents),reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),actor_user_id TEXT NOT NULL,payload_fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT);
CREATE TRIGGER authorize_creator_fund_adjustment_request BEFORE INSERT ON owner_financial_adjustment_requests
WHEN NEW.adjustment_type='creator_funds' AND NOT EXISTS(SELECT 1 FROM users u JOIN creator_identity_ownership o ON o.owner_user_id=u.id WHERE u.id=NEW.actor_user_id AND u.role IN ('owner','admin') AND o.creator_id=NEW.creator_id AND o.identity_type='primary')
BEGIN SELECT RAISE(ABORT,'owner primary Creator identity required'); END;
CREATE TRIGGER compare_creator_fund_adjustment_request BEFORE INSERT ON owner_financial_adjustment_requests
WHEN NEW.adjustment_type='creator_funds' AND (SELECT signed_total_cents FROM creator_signed_financial_totals WHERE creator_id=NEW.creator_id)<>NEW.expected_total_cents
BEGIN SELECT RAISE(ABORT,'financial total changed; refresh and try again'); END;
CREATE TRIGGER apply_creator_fund_adjustment_request AFTER INSERT ON owner_financial_adjustment_requests WHEN NEW.adjustment_type='creator_funds'
BEGIN
  INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,operator_actor,idempotency_key,created_at) VALUES(NEW.creator_id,'manual_adjustment',NEW.delta_cents,'USD',NEW.created_at,'available',NEW.reason,NEW.actor_user_id,'owner-adjustment-request:'||NEW.id,NEW.created_at);
  INSERT INTO creator_fund_target_adjustments(id,creator_id,ledger_entry_id,previous_total_cents,new_total_cents,delta_cents,reason,actor_user_id,created_at) VALUES(NEW.id,NEW.creator_id,(SELECT id FROM creator_earnings_ledger WHERE idempotency_key='owner-adjustment-request:'||NEW.id),NEW.expected_total_cents,NEW.desired_total_cents,NEW.delta_cents,NEW.reason,NEW.actor_user_id,NEW.created_at);
END;
CREATE TRIGGER authorize_trg_revenue_adjustment_request BEFORE INSERT ON owner_financial_adjustment_requests
WHEN NEW.adjustment_type='trg_revenue' AND NOT EXISTS(SELECT 1 FROM users u JOIN creator_identity_ownership o ON o.owner_user_id=u.id WHERE u.id=NEW.actor_user_id AND u.role IN ('owner','admin') AND o.creator_id=NEW.creator_id AND o.identity_type='primary')
BEGIN SELECT RAISE(ABORT,'owner primary Creator identity required'); END;
CREATE TRIGGER compare_trg_revenue_adjustment_request BEFORE INSERT ON owner_financial_adjustment_requests
WHEN NEW.adjustment_type='trg_revenue' AND (SELECT signed_total_cents FROM trg_signed_revenue_total)<>NEW.expected_total_cents
BEGIN SELECT RAISE(ABORT,'financial total changed; refresh and try again'); END;
CREATE TRIGGER apply_trg_revenue_adjustment_request AFTER INSERT ON owner_financial_adjustment_requests WHEN NEW.adjustment_type='trg_revenue'
BEGIN
  INSERT INTO trg_revenue_adjustments(id,previous_total_cents,new_total_cents,delta_cents,reason,actor_user_id,created_at) VALUES(NEW.id,NEW.expected_total_cents,NEW.desired_total_cents,NEW.delta_cents,NEW.reason,NEW.actor_user_id,NEW.created_at);
END;
CREATE TRIGGER preserve_owner_financial_adjustment_request BEFORE UPDATE ON owner_financial_adjustment_requests
BEGIN SELECT RAISE(ABORT,'owner financial adjustment request is immutable'); END;
CREATE TRIGGER preserve_owner_financial_adjustment_request_delete BEFORE DELETE ON owner_financial_adjustment_requests
BEGIN SELECT RAISE(ABORT,'owner financial adjustment request is immutable'); END;
