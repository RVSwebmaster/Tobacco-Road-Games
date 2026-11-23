-- Versioned Owner-approved commission terms. Existing fee-policy rows and
-- snapshots remain historical; this version is used only by new checkouts.
CREATE TABLE creator_commission_policy_versions (
  version TEXT PRIMARY KEY,
  standard_creator_basis_points INTEGER NOT NULL CHECK(standard_creator_basis_points=9000),
  founding25_creator_basis_points INTEGER NOT NULL CHECK(founding25_creator_basis_points=9500),
  premier_creator_basis_points INTEGER NOT NULL CHECK(premier_creator_basis_points=9500),
  owner_creator_basis_points INTEGER NOT NULL CHECK(owner_creator_basis_points=0),
  admin_creator_basis_points INTEGER NOT NULL CHECK(admin_creator_basis_points=0),
  effective_at TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  policy_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO creator_commission_policy_versions(
  version,standard_creator_basis_points,founding25_creator_basis_points,
  premier_creator_basis_points,owner_creator_basis_points,admin_creator_basis_points,
  effective_at,approved_by,policy_note,created_at
) VALUES(
  'owner-approved-commission-v1',9000,9500,9500,0,0,
  '2026-11-18T00:00:00.000Z','owner-approved',
  'Owner-approved C2C commission and processing-fee policy; supersedes prior terms for future checkout snapshots only.',
  '2026-11-18T00:00:00.000Z'
);

-- Founding-25 is a financial assignment, distinct from the historical
-- Founding Creator badge. Assignment/revocation is append-only and auditable.
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

ALTER TABLE order_items ADD COLUMN creator_commission_category_snapshot TEXT
  CHECK(creator_commission_category_snapshot IS NULL OR creator_commission_category_snapshot IN ('standard','founding25','premier','owner','admin'));
ALTER TABLE order_items ADD COLUMN creator_commission_policy_version_snapshot TEXT;
ALTER TABLE creator_sale_snapshots ADD COLUMN account_category TEXT NOT NULL DEFAULT 'standard'
  CHECK(account_category IN ('standard','founding25','premier','owner','admin'));

-- One authoritative fee result per paid order. Product-item allocations and
-- the non-product portion are stored separately to preserve exact money math.
CREATE TABLE stripe_order_fee_reconciliations (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  payment_intent_id TEXT NOT NULL,
  charge_id TEXT,
  balance_transaction_id TEXT UNIQUE,
  transaction_amount_cents INTEGER NOT NULL CHECK(typeof(transaction_amount_cents)='integer' AND transaction_amount_cents>=0),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  total_fee_cents INTEGER,
  processing_fee_cents INTEGER,
  non_processing_fee_cents INTEGER,
  non_product_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(non_product_amount_cents)='integer' AND non_product_amount_cents>=0),
  non_product_processing_fee_cents INTEGER,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(tax_amount_cents)='integer' AND tax_amount_cents>=0),
  other_non_product_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(other_non_product_amount_cents)='integer' AND other_non_product_amount_cents>=0),
  tax_processing_fee_cents INTEGER,
  other_non_product_processing_fee_cents INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','reconciled','needs_review')),
  provider_event_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  created_at TEXT NOT NULL,
  reconciled_at TEXT,
  CHECK((status='pending' AND processing_fee_cents IS NULL AND balance_transaction_id IS NULL)
    OR (status='reconciled' AND processing_fee_cents IS NOT NULL AND balance_transaction_id IS NOT NULL)
    OR status='needs_review')
);

CREATE TABLE stripe_order_fee_allocations (
  order_item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE RESTRICT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  account_category TEXT NOT NULL CHECK(account_category IN ('standard','founding25','premier','owner','admin')),
  item_amount_cents INTEGER NOT NULL CHECK(typeof(item_amount_cents)='integer' AND item_amount_cents>=0),
  processing_fee_cents INTEGER NOT NULL CHECK(typeof(processing_fee_cents)='integer' AND processing_fee_cents>=0),
  creator_absorbed_fee_cents INTEGER NOT NULL CHECK(typeof(creator_absorbed_fee_cents)='integer' AND creator_absorbed_fee_cents>=0),
  trg_absorbed_fee_cents INTEGER NOT NULL CHECK(typeof(trg_absorbed_fee_cents)='integer' AND trg_absorbed_fee_cents>=0),
  balance_transaction_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(creator_absorbed_fee_cents+trg_absorbed_fee_cents=processing_fee_cents)
);
CREATE INDEX idx_stripe_order_fee_allocations_order ON stripe_order_fee_allocations(order_id);

CREATE TRIGGER protect_creator_commission_policy_version_update
BEFORE UPDATE ON creator_commission_policy_versions
BEGIN SELECT RAISE(ABORT,'commission policy versions are immutable'); END;
CREATE TRIGGER protect_creator_commission_policy_version_delete
BEFORE DELETE ON creator_commission_policy_versions
BEGIN SELECT RAISE(ABORT,'commission policy versions are immutable'); END;
