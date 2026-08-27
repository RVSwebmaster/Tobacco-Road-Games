ALTER TABLE marketplace_creators ADD COLUMN intake_registration_completed_at TEXT;

UPDATE marketplace_creators
SET intake_registration_completed_at=COALESCE(registration_completed_at,updated_at)
WHERE marketplace_status='approved'
AND slug<>'' AND display_name<>'' AND short_bio<>''
AND (EXISTS (
  SELECT 1 FROM creator_identity_ownership ownership
  WHERE ownership.creator_id=marketplace_creators.id
    AND ownership.entitlement_source='legacy_grandfathered'
)
OR EXISTS (
  SELECT 1 FROM creator_identity_ownership ownership
  JOIN users account ON account.id=ownership.owner_user_id
  JOIN user_account_profiles profile ON profile.user_id=ownership.owner_user_id
  JOIN creator_registration_details details ON details.creator_id=ownership.creator_id
  JOIN creator_payout_profiles payout ON payout.creator_id=ownership.creator_id
  JOIN creator_agreement_acceptances agreement ON agreement.creator_id=ownership.creator_id
  WHERE ownership.creator_id=marketplace_creators.id
    AND account.status='active' AND account.email_verified=1
    AND account.email_normalized LIKE '%_@_%._%'
    AND profile.legal_name<>'' AND profile.payment_method_status='ready'
    AND details.legal_name<>'' AND details.business_type<>''
    AND details.country<>'' AND details.state_region<>''
    AND details.address_line1<>'' AND details.city<>''
    AND details.postal_code<>'' AND details.contact_email LIKE '%_@_%._%'
    AND details.rights_confirmation_at<>''
    AND agreement.agreement_id='trg-creator-marketplace-agreement'
    AND agreement.agreement_version='2026-08-27'
    AND agreement.superseded_at IS NULL
    AND payout.onboarding_status='complete'
    AND payout.verification_status='verified' AND payout.payouts_enabled=1
    AND ownership.account_status='active'
    AND (ownership.identity_type='primary' OR ownership.billing_status IN ('current','legacy_grandfathered'))
));
