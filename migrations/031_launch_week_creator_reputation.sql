CREATE TABLE marketplace_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('launch_week')),
  title TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'prelaunch' CHECK(lifecycle_state IN ('prelaunch','live','archive')),
  starts_at TEXT,
  ends_at TEXT,
  founding_window_start TEXT,
  founding_window_end TEXT,
  content_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(content_json)),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CHECK(founding_window_start IS NULL OR founding_window_end IS NULL OR founding_window_start <= founding_window_end)
);

INSERT INTO marketplace_events(id,event_type,title,lifecycle_state,content_json,is_public,created_at,updated_at)
VALUES('official-launch-week','launch_week','Launch Week','prelaunch','{"prelaunch":{"eyebrow":"Marketplace launch","heading":"Launch Week is being prepared","body":"Dates and event details will be announced when they are ready."},"live":{"eyebrow":"Launch Week","heading":"The marketplace is opening","body":"Discover participating Creators and new tabletop work."},"archive":{"eyebrow":"Launch Week archive","heading":"The founding launch","body":"A historical record of the marketplace launch."},"dailySlots":[]}',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

CREATE TABLE creator_badge_definitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('historical','achievement','service_tier','reputation_status')),
  icon_asset_key TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  display_priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO creator_badge_definitions(id,title,short_description,category,display_priority,created_at,updated_at) VALUES
('founding-creator','Founding Creator','Joined Tobacco Road Games during its founding launch.','historical',10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('preferred-creator','Preferred Creator','An active paid Tobacco Road Games service tier.','service_tier',20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

CREATE TABLE creator_badge_awards (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_notes TEXT NOT NULL DEFAULT '',
  awarded_at TEXT NOT NULL,
  awarded_by TEXT NOT NULL,
  expires_at TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked','corrected','expired')),
  state_reason TEXT NOT NULL DEFAULT '',
  state_changed_at TEXT,
  state_changed_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(creator_id,badge_id),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(badge_id) REFERENCES creator_badge_definitions(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_badge_awards_display ON creator_badge_awards(creator_id,state,awarded_at);

CREATE TABLE creator_reputation_ratings (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  acquisition_order_id INTEGER NOT NULL,
  rating_value INTEGER NOT NULL CHECK(rating_value BETWEEN 1 AND 5),
  feedback_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(feedback_json)),
  moderation_state TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_state IN ('visible','hidden','under_review')),
  fraud_state TEXT NOT NULL DEFAULT 'clear' CHECK(fraud_state IN ('clear','suspected','confirmed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(creator_id,user_id),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(acquisition_order_id) REFERENCES orders(id) ON DELETE RESTRICT
);
CREATE INDEX idx_creator_ratings_public ON creator_reputation_ratings(creator_id,moderation_state,fraud_state,rating_value);

CREATE TABLE creator_reputation_rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rating_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created','updated','moderated','restored')),
  prior_rating_value INTEGER,
  rating_value INTEGER NOT NULL CHECK(rating_value BETWEEN 1 AND 5),
  moderation_state TEXT NOT NULL,
  fraud_state TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL CHECK(actor_type IN ('customer','operator','system')),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(rating_id) REFERENCES creator_reputation_ratings(id) ON DELETE RESTRICT
);

CREATE TABLE creator_reputation_labels (
  creator_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(label IN ('top_rated','customer_favorite','new_and_rising','best_selling','most_downloaded')),
  state TEXT NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','active','inactive')),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json)),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY(creator_id,label),
  FOREIGN KEY(creator_id) REFERENCES marketplace_creators(id) ON DELETE RESTRICT
);

CREATE TABLE creator_reputation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('operator','system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('event','badge_definition','badge_award','founding_reconciliation','rating')),
  subject_id TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  created_at TEXT NOT NULL
);
