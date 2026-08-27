CREATE TABLE creator_ad_creatives (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, listing_id TEXT NOT NULL, alt_text TEXT NOT NULL,
  original_filename TEXT NOT NULL, normalized_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  staging_key TEXT NOT NULL, public_object_key TEXT, validation_state TEXT NOT NULL DEFAULT 'uploaded' CHECK(validation_state IN ('uploaded','accepted','rejected')),
  created_at TEXT NOT NULL, validated_at TEXT, FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id), FOREIGN KEY(listing_id) REFERENCES creator_listings(id)
);
CREATE INDEX idx_creator_ad_creatives_owner ON creator_ad_creatives(creator_id,created_at);

CREATE TABLE creator_ad_slots (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, slot_type TEXT NOT NULL CHECK(slot_type IN ('included','purchased')),
  slot_index INTEGER NOT NULL, creative_id TEXT, activated_at TEXT NOT NULL, expires_at TEXT, deactivated_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id), FOREIGN KEY(creative_id) REFERENCES creator_ad_creatives(id)
);
CREATE UNIQUE INDEX idx_creator_ad_slot_identity ON creator_ad_slots(creator_id,slot_type,slot_index,activated_at);

CREATE TABLE creator_ad_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id TEXT NOT NULL, entry_type TEXT NOT NULL CHECK(entry_type IN ('pack_purchase','slot_redemption','operator_adjustment')),
  quantity INTEGER NOT NULL, stripe_checkout_session_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id)
);
CREATE TABLE creator_ad_credit_purchases (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 5, amount_cents INTEGER NOT NULL DEFAULT 500,
  currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','failed')),
  stripe_checkout_session_id TEXT UNIQUE, checkout_url TEXT, created_at TEXT NOT NULL, paid_at TEXT, FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id)
);

CREATE TABLE marketplace_ads (
  id TEXT PRIMARY KEY, pool TEXT NOT NULL CHECK(pool IN ('house','event','vendor_sponsor','preferred_notice')),
  sponsor_name TEXT, title TEXT NOT NULL, alt_text TEXT NOT NULL, creative_url TEXT NOT NULL, destination_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','rejected')), approval_state TEXT NOT NULL DEFAULT 'pending' CHECK(approval_state IN ('pending','approved','rejected')),
  starts_at TEXT, ends_at TEXT, allocation_weight INTEGER NOT NULL DEFAULT 1 CHECK(allocation_weight BETWEEN 1 AND 5), impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE ad_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ad_key TEXT NOT NULL, ad_kind TEXT NOT NULL CHECK(ad_kind IN ('creator','marketplace')),
  event_type TEXT NOT NULL CHECK(event_type IN ('impression','click')), event_bucket TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(ad_key,event_type,event_bucket)
);
CREATE TABLE advertising_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id TEXT, creative_id TEXT, slot_id TEXT, marketplace_ad_id TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('creator','operator','system')), actor_id TEXT NOT NULL, action TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
