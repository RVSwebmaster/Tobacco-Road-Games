ALTER TABLE webhook_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);
ALTER TABLE webhook_events ADD COLUMN last_attempt_at TEXT;
ALTER TABLE webhook_events ADD COLUMN processing_token TEXT;
ALTER TABLE webhook_events ADD COLUMN processing_started_at TEXT;
ALTER TABLE webhook_events ADD COLUMN failure_code TEXT;
ALTER TABLE webhook_events ADD COLUMN processing_result TEXT;
ALTER TABLE webhook_events ADD COLUMN event_livemode INTEGER CHECK (event_livemode IS NULL OR event_livemode IN (0, 1));
ALTER TABLE webhook_events ADD COLUMN stripe_api_version TEXT;
ALTER TABLE webhook_events ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE webhook_events ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE webhook_events ADD COLUMN event_amount_total_cents INTEGER CHECK (
  event_amount_total_cents IS NULL OR (
    typeof(event_amount_total_cents) = 'integer' AND event_amount_total_cents >= 0
  )
);
ALTER TABLE webhook_events ADD COLUMN event_currency TEXT CHECK (
  event_currency IS NULL OR length(event_currency) = 3
);

CREATE INDEX idx_webhook_events_processing_status
  ON webhook_events (processing_status, received_at);

