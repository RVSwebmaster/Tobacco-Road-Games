-- A category copied by migration 075's compatibility default is not evidence
-- of the Creator's historical commercial classification. Keep it visibly
-- unverified unless a sale carries an explicit, immutable policy snapshot.
ALTER TABLE creator_sale_snapshots ADD COLUMN account_category_verified INTEGER NOT NULL DEFAULT 0
  CHECK(account_category_verified IN (0,1));

-- There are at most 25 distinct active/reserved assignments. The table guard,
-- rather than an application-side count, serializes the cap under concurrent
-- writes. Revoked rows remain as history and never allocate a seat by themselves.
CREATE UNIQUE INDEX idx_creator_founding25_one_active_assignment
  ON creator_commission_category_assignments(creator_id)
  WHERE category='founding25' AND revoked_at IS NULL;

CREATE TRIGGER enforce_founding25_assignment_limit_insert
BEFORE INSERT ON creator_commission_category_assignments
WHEN NEW.category='founding25' AND NEW.revoked_at IS NULL
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(DISTINCT creator_id) FROM creator_commission_category_assignments
      WHERE category='founding25' AND revoked_at IS NULL) >= 25
    THEN RAISE(ABORT,'founding25 assignment limit reached')
  END;
END;

CREATE TRIGGER enforce_founding25_assignment_limit_reactivation
BEFORE UPDATE OF revoked_at ON creator_commission_category_assignments
WHEN NEW.category='founding25' AND OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL
BEGIN
  SELECT CASE WHEN
    (SELECT COUNT(DISTINCT creator_id) FROM creator_commission_category_assignments
      WHERE category='founding25' AND revoked_at IS NULL AND id<>OLD.id) >= 25
    THEN RAISE(ABORT,'founding25 assignment limit reached')
  END;
END;
