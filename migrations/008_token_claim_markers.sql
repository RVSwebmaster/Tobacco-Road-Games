ALTER TABLE email_verification_tokens
  ADD COLUMN claim_marker TEXT;

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_claim_marker
  ON email_verification_tokens (claim_marker);

ALTER TABLE password_reset_tokens
  ADD COLUMN claim_marker TEXT;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_claim_marker
  ON password_reset_tokens (claim_marker);
