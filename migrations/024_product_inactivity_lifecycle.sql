ALTER TABLE creator_listings ADD COLUMN inactivity_state TEXT NOT NULL DEFAULT 'active' CHECK(inactivity_state IN ('active','warning','inactive'));
ALTER TABLE creator_listings ADD COLUMN last_qualifying_activity_at TEXT;
ALTER TABLE creator_listings ADD COLUMN inactivity_warning_started_at TEXT;
ALTER TABLE creator_listings ADD COLUMN inactivity_grace_ends_at TEXT;
ALTER TABLE creator_listings ADD COLUMN inactivity_transitioned_at TEXT;
ALTER TABLE creator_listings ADD COLUMN inactivity_reactivated_at TEXT;

CREATE TABLE creator_product_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, order_id INTEGER NOT NULL, order_item_id INTEGER NOT NULL UNIQUE,
  activity_type TEXT NOT NULL CHECK(activity_type IN ('paid_sale','free_acquisition','pwyw_paid','pwyw_free')),
  occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_product_activity_listing_date ON creator_product_activity_events(listing_id,occurred_at);

CREATE TABLE creator_lifecycle_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  notice_type TEXT NOT NULL CHECK(notice_type IN ('inactivity_warning','warning_expiring','inactivity_cleared','inactivated','reactivated','lifecycle_error')),
  dedupe_key TEXT NOT NULL UNIQUE, dashboard_status TEXT NOT NULL DEFAULT 'unread' CHECK(dashboard_status IN ('unread','read')),
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK(email_status IN ('pending','sent','failed','not_configured')),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(listing_id) REFERENCES creator_listings(id) ON DELETE RESTRICT,
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_lifecycle_notices_creator ON creator_lifecycle_notices(creator_id,dashboard_status,created_at);
