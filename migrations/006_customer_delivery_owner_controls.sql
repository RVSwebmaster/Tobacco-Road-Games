CREATE TABLE order_access_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  token_nonce TEXT NOT NULL CHECK (length(token_nonce) >= 32),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  UNIQUE (order_id, generation)
);

CREATE UNIQUE INDEX idx_order_access_one_active
  ON order_access_credentials (order_id)
  WHERE status = 'active';

CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_access_credential_id INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('delivery', 'owner_resend')),
  message_number INTEGER NOT NULL CHECK (message_number > 0),
  message_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  provider_idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TEXT,
  accepted_at TEXT,
  delivered_at TEXT,
  delayed_at TEXT,
  failed_at TEXT,
  bounced_at TEXT,
  suppressed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (order_access_credential_id) REFERENCES order_access_credentials(id) ON DELETE RESTRICT,
  UNIQUE (order_id, order_access_credential_id, message_number)
);

CREATE INDEX idx_email_outbox_order
  ON email_outbox (order_id, created_at);

CREATE INDEX idx_email_outbox_retry
  ON email_outbox (status, updated_at);

CREATE TABLE email_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  provider_event_id TEXT NOT NULL,
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    processing_status IN ('pending', 'processed', 'failed', 'ignored')
  ),
  email_outbox_id INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (email_outbox_id) REFERENCES email_outbox(id) ON DELETE SET NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_email_webhook_message
  ON email_webhook_events (provider_message_id);

CREATE TABLE owner_order_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'rejected', 'failed')),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX idx_owner_order_audit_order
  ON owner_order_audit (order_id, created_at);
