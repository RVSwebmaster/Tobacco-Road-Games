-- Focused account and Profile prerequisite for a production-072 schema.
-- Apply only after release authorization, outside the numbered migration ledger.
-- Both tables start empty. Existing customer and creator records are preserved.

-- From 079: existing accounts without a state row retain their current access.
CREATE TABLE customer_registration_states (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('pending','active')),
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- From 075: only the authoritative Founding-25 designation lookup.
CREATE TABLE creator_commission_category_assignments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES marketplace_creators(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK(category='founding25'),
  effective_at TEXT NOT NULL,
  revoked_at TEXT,
  assigned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(revoked_at IS NULL OR revoked_at>=effective_at)
);
CREATE INDEX idx_creator_commission_assignments_current
  ON creator_commission_category_assignments(creator_id,effective_at,revoked_at);
