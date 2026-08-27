CREATE TABLE user_account_profiles (
  user_id TEXT PRIMARY KEY, legal_name TEXT NOT NULL DEFAULT '', birthday TEXT, phone TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', notification_preferences_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(notification_preferences_json)),
  stripe_customer_reference TEXT NOT NULL DEFAULT '', default_payment_method_reference TEXT NOT NULL DEFAULT '', payment_card_brand TEXT NOT NULL DEFAULT '', payment_card_last4 TEXT NOT NULL DEFAULT '',
  payment_method_status TEXT NOT NULL DEFAULT 'missing' CHECK(payment_method_status IN ('missing','pending','ready','expired','restricted')),
  payment_method_status_updated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE user_shipping_addresses (
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',recipient_name TEXT NOT NULL,address_line1 TEXT NOT NULL,address_line2 TEXT NOT NULL DEFAULT '',city TEXT NOT NULL,state_region TEXT NOT NULL DEFAULT '',postal_code TEXT NOT NULL,country TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_shipping_addresses_owner ON user_shipping_addresses(user_id,is_default DESC);

ALTER TABLE marketplace_creators ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'incomplete' CHECK(registration_status IN ('incomplete','active','restricted','suspended','agreement_required'));
ALTER TABLE marketplace_creators ADD COLUMN registration_completed_at TEXT;
UPDATE marketplace_creators SET registration_status=CASE marketplace_status WHEN 'approved' THEN 'active' WHEN 'suspended' THEN 'suspended' ELSE 'incomplete' END,registration_completed_at=CASE WHEN marketplace_status='approved' THEN updated_at ELSE NULL END;

CREATE TABLE creator_identity_ownership (
  creator_id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,identity_type TEXT NOT NULL CHECK(identity_type IN ('primary','additional')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('pending','active','restricted','suspended')),
  billing_cadence TEXT CHECK(billing_cadence IS NULL OR billing_cadence IN ('monthly','annual_prepaid')),
  billing_status TEXT NOT NULL DEFAULT 'not_required' CHECK(billing_status IN ('not_required','pending','current','past_due','cancelled','legacy_grandfathered')),
  entitlement_source TEXT NOT NULL CHECK(entitlement_source IN ('primary_free','additional_paid','legacy_grandfathered')),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE,FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_creator_one_primary_per_owner ON creator_identity_ownership(owner_user_id) WHERE identity_type='primary';

CREATE TABLE creator_registration_details (
  creator_id TEXT PRIMARY KEY,legal_name TEXT NOT NULL,business_name TEXT NOT NULL DEFAULT '',business_type TEXT NOT NULL,country TEXT NOT NULL,state_region TEXT NOT NULL,
  address_line1 TEXT NOT NULL,address_line2 TEXT NOT NULL DEFAULT '',city TEXT NOT NULL,postal_code TEXT NOT NULL,contact_email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',
  rights_confirmation_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE
);
CREATE TABLE creator_agreement_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,creator_id TEXT NOT NULL,accepted_by_user_id TEXT NOT NULL,agreement_id TEXT NOT NULL,agreement_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,source_context TEXT NOT NULL,ip_hash TEXT NOT NULL DEFAULT '',superseded_at TEXT,
  UNIQUE(creator_id,agreement_id,agreement_version),FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE CASCADE,FOREIGN KEY(accepted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE creator_listing_declarations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,listing_id TEXT NOT NULL,creator_id TEXT NOT NULL,declared_by_user_id TEXT NOT NULL,submission_key TEXT NOT NULL,
  rights_confirmed INTEGER NOT NULL CHECK(rights_confirmed=1),representation_confirmed INTEGER NOT NULL CHECK(representation_confirmed=1),licenses_confirmed INTEGER NOT NULL CHECK(licenses_confirmed=1),
  declared_at TEXT NOT NULL,UNIQUE(listing_id,submission_key),FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT,FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,FOREIGN KEY(declared_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

WITH ranked_managers AS (
  SELECT c.id creator_id,c.created_at,c.updated_at,cm.user_id,
    ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY cm.created_at,cm.user_id) creator_manager_rank
  FROM marketplace_creators c JOIN creator_memberships cm ON cm.creator_id=c.id
  WHERE cm.permission='manager'
), ranked_owners AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at,creator_id) owner_identity_rank
  FROM ranked_managers WHERE creator_manager_rank=1
)
INSERT OR IGNORE INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_status,entitlement_source,created_at,updated_at)
SELECT creator_id,user_id,CASE owner_identity_rank WHEN 1 THEN 'primary' ELSE 'additional' END,'active','legacy_grandfathered','legacy_grandfathered',created_at,updated_at FROM ranked_owners;
