PRAGMA foreign_keys = ON;

ALTER TABLE forum_topics ADD COLUMN moderation_state TEXT NOT NULL DEFAULT 'active' CHECK (moderation_state IN ('active', 'locked', 'hidden'));
ALTER TABLE forum_topics ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));
ALTER TABLE forum_posts ADD COLUMN moderation_state TEXT NOT NULL DEFAULT 'active' CHECK (moderation_state IN ('active', 'hidden'));

CREATE TABLE forum_reports (
  id TEXT PRIMARY KEY,
  reporting_profile_id TEXT NOT NULL,
  reported_topic_id TEXT,
  reported_post_id TEXT,
  reason_category TEXT NOT NULL CHECK (reason_category IN ('spam','harassment','hate_abuse','sexual_mature','graphic_violence','personal_information','copyright_ownership','other')),
  explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolving_moderator_user_id TEXT,
  CHECK ((reported_topic_id IS NOT NULL AND reported_post_id IS NULL) OR (reported_topic_id IS NULL AND reported_post_id IS NOT NULL)),
  FOREIGN KEY (reporting_profile_id) REFERENCES forum_profiles(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (reported_topic_id) REFERENCES forum_topics(id) ON DELETE RESTRICT,
  FOREIGN KEY (reported_post_id) REFERENCES forum_posts(id) ON DELETE RESTRICT,
  FOREIGN KEY (resolving_moderator_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_forum_reports_open_topic ON forum_reports (reporting_profile_id, reported_topic_id, reason_category) WHERE status = 'open' AND reported_topic_id IS NOT NULL;
CREATE UNIQUE INDEX idx_forum_reports_open_post ON forum_reports (reporting_profile_id, reported_post_id, reason_category) WHERE status = 'open' AND reported_post_id IS NOT NULL;
CREATE INDEX idx_forum_reports_status_created ON forum_reports (status, created_at);

CREATE TABLE forum_moderation_log (
  id TEXT PRIMARY KEY,
  acting_moderator_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  affected_type TEXT NOT NULL CHECK (affected_type IN ('topic','post','profile','account','report')),
  affected_id TEXT NOT NULL,
  internal_reason TEXT NOT NULL CHECK (length(trim(internal_reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (acting_moderator_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_forum_moderation_log_created ON forum_moderation_log (created_at DESC);
