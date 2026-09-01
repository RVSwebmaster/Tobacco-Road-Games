export const REFUND_ELIGIBLE_REASONS = Object.freeze([
  "corrupt_file",
  "wrong_file",
  "material_misrepresentation",
  "delivery_failure",
  "other_objective_defect",
]);

export async function assertVerifiedPurchaseIdentity(
  database,
  { session, emailHash } = {},
) {
  if (session?.user) {
    if (Number(session.user.email_verified) !== 1)
      throw policyError(
        "verified_email_required",
        "Verify your account email before completing this acquisition.",
      );
    return {
      kind: "account",
      userId: session.user.id,
      email: session.user.email,
    };
  }
  const row = await database
    .prepare(
      "SELECT verified_at,expires_at FROM guest_email_verifications WHERE email_hash=?",
    )
    .bind(String(emailHash))
    .first();
  if (!row?.verified_at || Date.parse(row.expires_at) <= Date.now())
    throw policyError(
      "verified_email_required",
      "Verify this email address before completing guest checkout.",
    );
  return { kind: "guest", emailHash: String(emailHash) };
}
export async function assertNotFraudBlocked(
  database,
  { emailHash, userId = null } = {},
) {
  const row = await database
    .prepare(
      "SELECT id FROM marketplace_fraud_blocks WHERE status='active' AND (email_hash=? OR (? IS NOT NULL AND user_id=?)) LIMIT 1",
    )
    .bind(String(emailHash), userId, userId)
    .first();
  if (row)
    throw policyError(
      "purchase_blocked",
      "This customer cannot complete marketplace transactions.",
    );
}
export async function findDuplicateDigitalOwnership(
  database,
  { userId = null, emailHash, productSlugs = [] } = {},
) {
  if (!productSlugs.length) return [];
  const marks = productSlugs.map(() => "?").join(",");
  const result = await database
    .prepare(
      `SELECT DISTINCT e.product_slug FROM download_entitlements e JOIN orders o ON o.id=e.order_id WHERE e.status='active' AND o.payment_status IN ('paid','refunded','disputed') AND e.product_slug IN (${marks}) AND (o.user_id=? OR o.customer_email_hash=?)`,
    )
    .bind(...productSlugs, userId, emailHash)
    .all();
  return (result.results || []).map((x) => x.product_slug);
}
export function assertRefundEligibility(reason) {
  if (!REFUND_ELIGIBLE_REASONS.includes(String(reason)))
    throw policyError(
      "refund_not_eligible",
      "Refunds require an objectively demonstrable product or transaction problem.",
    );
  return true;
}
export async function openProductRemediation(
  database,
  { listingId, reason, notes = "", nowMs = Date.now() } = {},
) {
  assertRefundEligibility(reason);
  const id = crypto.randomUUID(),
    opened = new Date(nowMs),
    due = new Date(nowMs + 30 * 86400000);
  await database.batch([
    database
      .prepare(
        "UPDATE creator_listings SET publication_state='paused',lifecycle_state='paused',updated_at=? WHERE id=?",
      )
      .bind(opened.toISOString(), listingId),
    database
      .prepare(
        "INSERT INTO product_remediation_cases(id,listing_id,status,defect_type,opened_at,repair_due_at,notes) VALUES(?,?,'repair_open',?,?,?,?)",
      )
      .bind(
        id,
        listingId,
        reason,
        opened.toISOString(),
        due.toISOString(),
        String(notes),
      ),
  ]);
  return { id, repairDueAt: due.toISOString() };
}
export async function requestCreatorPayout(
  database,
  {
    creatorId,
    amountCents,
    currency = "USD",
    accountClosure = false,
    nowMs = Date.now(),
  } = {},
) {
  const amount = Number(amountCents),
    liability = await getCreatorLiability(database, creatorId, {
      currency,
      nowMs,
    });
  if (liability.payoutEligibleCents <= 0)
    throw policyError(
      "negative_balance",
      "A payout cannot be requested while the Creator balance is zero or negative.",
    );
  if (!accountClosure && amount < 1000)
    throw policyError(
      "minimum_payout",
      "Normal withdrawals require at least $10.",
    );
  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > liability.payoutEligibleCents
  )
    throw policyError(
      "invalid_payout",
      "The requested payout exceeds the eligible balance.",
    );
  try {
    const reserved = await reserveCreatorPayout(database, {
      creatorId,
      amountCents: amount,
      currency,
      accountClosure,
      nowMs,
    });
    return { id: reserved.requestId, amountCents: reserved.amountCents };
  } catch (error) {
    throw policyError(
      "payout_pending",
      String(
        error?.message || "Only one payout request may be pending at a time.",
      ),
    );
  }
}
function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
import {
  getCreatorLiability,
  reserveCreatorPayout,
} from "./creator-liability.mjs";
