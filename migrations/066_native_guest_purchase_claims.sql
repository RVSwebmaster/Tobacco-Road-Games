-- A paid native guest entitlement starts with no account owner. Permit exactly
-- one ownership association when the verified order-access claim attaches the
-- matching order to an account. All purchase-time snapshot fields remain
-- immutable.
DROP TRIGGER protect_native_entitlement_snapshot;

CREATE TRIGGER validate_native_entitlement_account_claim
BEFORE UPDATE OF purchaser_user_id ON native_product_entitlements
WHEN OLD.purchaser_user_id IS NOT NEW.purchaser_user_id
BEGIN
  SELECT RAISE(ABORT, 'native entitlement account claim is not authorized')
  WHERE OLD.purchaser_user_id IS NOT NULL
    OR NEW.purchaser_user_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = OLD.order_id
        AND o.catalog_source = 'native_d1'
        AND o.payment_status = 'paid'
        AND o.native_order_state = 'paid'
        AND o.native_entitlement_status = 'ready'
        AND o.user_id = NEW.purchaser_user_id
        AND o.customer_email_hash = OLD.purchaser_email_hash_snapshot
    );
END;

CREATE TRIGGER protect_native_entitlement_snapshot
BEFORE UPDATE ON native_product_entitlements
WHEN OLD.order_id IS NOT NEW.order_id
  OR OLD.order_item_id IS NOT NEW.order_item_id
  OR OLD.purchaser_email_hash_snapshot IS NOT NEW.purchaser_email_hash_snapshot
  OR OLD.native_product_id IS NOT NEW.native_product_id
  OR OLD.product_slug_snapshot IS NOT NEW.product_slug_snapshot
  OR OLD.product_title_snapshot IS NOT NEW.product_title_snapshot
  OR OLD.native_creator_id IS NOT NEW.native_creator_id
  OR OLD.catalog_revision_snapshot IS NOT NEW.catalog_revision_snapshot
  OR OLD.version_snapshot IS NOT NEW.version_snapshot
  OR OLD.pricing_model_snapshot IS NOT NEW.pricing_model_snapshot
  OR OLD.selected_price_cents_snapshot IS NOT NEW.selected_price_cents_snapshot
  OR OLD.currency_snapshot IS NOT NEW.currency_snapshot
  OR OLD.entitlement_source IS NOT NEW.entitlement_source
  OR OLD.acquired_at IS NOT NEW.acquired_at
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'native entitlement purchase snapshots are immutable');
END;

CREATE INDEX idx_native_guest_claimable_orders
  ON orders(customer_email_hash, payment_status, native_order_state, user_id)
  WHERE catalog_source = 'native_d1' AND user_id IS NULL;
