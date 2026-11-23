ALTER TABLE user_account_profiles ADD COLUMN billing_first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_company TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_address_line1 TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_address_line2 TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_city TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_state_region TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN billing_country TEXT NOT NULL DEFAULT '';
ALTER TABLE user_account_profiles ADD COLUMN customer_activated_at TEXT;

CREATE TABLE customer_registration_consents (
  user_id TEXT PRIMARY KEY,
  terms_version TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  privacy_acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE customer_registration_states (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('pending','active')),
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE customer_payment_method_authorizations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  authorization_scope TEXT NOT NULL CHECK(authorization_scope='save_payment_method'),
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_customer_payment_method_authorizations_user
  ON customer_payment_method_authorizations(user_id,accepted_at);

CREATE TABLE customer_payment_setup_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_setup_intent_reference TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('creating','requires_confirmation','succeeded','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_customer_payment_setup_attempts_user
  ON customer_payment_setup_attempts(user_id,created_at);

CREATE TABLE customer_saved_payment_methods (
  payment_method_reference TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_customer_reference TEXT NOT NULL,
  cardholder_name TEXT NOT NULL DEFAULT '',
  card_brand TEXT NOT NULL,
  card_last4 TEXT NOT NULL CHECK(length(card_last4)=4 AND card_last4 NOT GLOB '*[^0-9]*'),
  expiration_month INTEGER CHECK(expiration_month IS NULL OR expiration_month BETWEEN 1 AND 12),
  expiration_year INTEGER CHECK(expiration_year IS NULL OR expiration_year BETWEEN 2000 AND 9999),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_customer_saved_payment_methods_user
  ON customer_saved_payment_methods(user_id,state,created_at);

-- Keep already-saved Creator/account cards visible without fabricating expiration data.
INSERT OR IGNORE INTO customer_saved_payment_methods(
  payment_method_reference,user_id,stripe_customer_reference,cardholder_name,card_brand,card_last4,
  expiration_month,expiration_year,state,created_at,updated_at
)
SELECT default_payment_method_reference,user_id,stripe_customer_reference,'',payment_card_brand,payment_card_last4,
  NULL,NULL,'active',created_at,updated_at
FROM user_account_profiles
WHERE payment_method_status='ready'
  AND substr(default_payment_method_reference,1,3)='pm_'
  AND length(default_payment_method_reference)>3
  AND substr(stripe_customer_reference,1,4)='cus_'
  AND length(stripe_customer_reference)>4
  AND length(payment_card_last4)=4
  AND payment_card_last4 NOT GLOB '*[^0-9]*';
