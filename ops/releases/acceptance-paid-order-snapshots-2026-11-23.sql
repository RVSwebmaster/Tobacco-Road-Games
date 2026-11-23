-- Acceptance-only focused overlay for the current paid Creator order path.
-- Derived from migrations 074 and 075; intentionally excludes deferred finance,
-- reserve, reconciliation, and policy-version tables or other migration objects.
-- Apply only after verifying that none of these nine columns already exists.

ALTER TABLE order_items ADD COLUMN creator_first_published_at_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN creator_fee_basis_points_snapshot INTEGER
  CHECK (creator_fee_basis_points_snapshot IS NULL OR
    (typeof(creator_fee_basis_points_snapshot)='integer' AND creator_fee_basis_points_snapshot BETWEEN 0 AND 10000));
ALTER TABLE order_items ADD COLUMN creator_fixed_fee_cents_snapshot INTEGER
  CHECK (creator_fixed_fee_cents_snapshot IS NULL OR
    (typeof(creator_fixed_fee_cents_snapshot)='integer' AND creator_fixed_fee_cents_snapshot >= 0));
ALTER TABLE order_items ADD COLUMN creator_reserve_days_snapshot INTEGER
  CHECK (creator_reserve_days_snapshot IS NULL OR
    (typeof(creator_reserve_days_snapshot)='integer' AND creator_reserve_days_snapshot BETWEEN 0 AND 365));
ALTER TABLE order_items ADD COLUMN creator_fee_policy_reason_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN creator_fee_policy_id_snapshot INTEGER;
ALTER TABLE order_items ADD COLUMN creator_fee_policy_effective_at_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN creator_commission_category_snapshot TEXT
  CHECK(creator_commission_category_snapshot IS NULL OR creator_commission_category_snapshot IN ('standard','founding25','premier','owner','admin'));
ALTER TABLE order_items ADD COLUMN creator_commission_policy_version_snapshot TEXT;
