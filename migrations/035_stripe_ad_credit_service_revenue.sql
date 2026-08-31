ALTER TABLE creator_ad_credit_purchases ADD COLUMN initiated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE marketplace_service_purchases ADD COLUMN provider_event_id TEXT;
ALTER TABLE marketplace_service_purchases ADD COLUMN provider_payment_reference TEXT;
ALTER TABLE marketplace_service_purchases ADD COLUMN processor_fee_authoritative INTEGER NOT NULL DEFAULT 0 CHECK(processor_fee_authoritative IN (0,1));
ALTER TABLE marketplace_service_purchases ADD COLUMN completed_at TEXT;

UPDATE marketplace_service_purchases
SET processor_fee_authoritative=1,
    completed_at=COALESCE(completed_at,created_at)
WHERE payment_source='creator_balance';

CREATE UNIQUE INDEX idx_service_purchase_stripe_session
  ON marketplace_service_purchases(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX idx_service_purchase_provider_event
  ON marketplace_service_purchases(provider_event_id)
  WHERE provider_event_id IS NOT NULL;
