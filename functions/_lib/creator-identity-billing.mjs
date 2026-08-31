import { createStripeHostedCheckoutSession } from "./stripe-checkout.mjs";
import { SERVICE_PRICING } from "./creator-service-purchases.mjs";

export async function getIdentityBillingState(db, creatorId, nowMs = Date.now()) {
  const identity = await db
      .prepare("SELECT * FROM creator_identity_ownership WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    latest = identity ? await optionalCoverage(db, creatorId) : null,
    active = Boolean(
      identity?.identity_type === "primary" ||
        identity?.billing_status === "legacy_grandfathered" ||
        (latest?.status === "active" &&
          latest?.purchase_status === "settled" &&
          Date.parse(latest.coverage_ends_at) > nowMs) ||
        (latest?.legacySchema && identity?.billing_status === "current"),
    );
  return {
    identityType: identity?.identity_type || "",
    included: identity?.identity_type === "primary",
    active,
    billingPlan: latest?.billing_plan || identity?.billing_cadence || null,
    coverageStartsAt: latest?.coverage_starts_at || null,
    coverageEndsAt: latest?.coverage_ends_at || null,
    paymentSource: latest?.payment_source || null,
    status:
      identity?.identity_type === "primary"
        ? "included"
        : identity?.billing_status === "legacy_grandfathered"
          ? "legacy_grandfathered"
          : active
            ? "current"
            : latest
              ? "expired"
              : "billing_required",
  };
}

async function optionalCoverage(db, creatorId) {
  try {
    return await db
      .prepare(
        "SELECT cp.*,p.payment_source,p.status purchase_status FROM creator_identity_coverage_periods cp JOIN marketplace_service_purchases p ON p.id=cp.service_purchase_id WHERE cp.creator_id=? ORDER BY cp.coverage_ends_at DESC LIMIT 1",
      )
      .bind(creatorId)
      .first();
  } catch (error) {
    if (/no such table/i.test(String(error))) return { legacySchema: true };
    throw error;
  }
}

export async function startStripeIdentityCoverage(
  db,
  { creatorId, userId, plan, email, env = {}, fetchImpl, nowMs = Date.now() } = {},
) {
  const sku = plan === "monthly" ? "additional_identity_monthly" : plan === "annual_prepaid" ? "additional_identity_annual" : "",
    price = SERVICE_PRICING[sku],
    identity = await db
      .prepare(
        "SELECT * FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=?",
      )
      .bind(creatorId, userId)
      .first();
  if (!price) throw new Error("Choose monthly or annual prepaid identity coverage.");
  if (!identity || identity.identity_type !== "additional")
    throw new Error("Only the owner may manage an additional Creator identity.");
  const id = crypto.randomUUID(),
    now = new Date(nowMs).toISOString();
  await db
    .prepare(
      "INSERT INTO creator_identity_billing_attempts(id,creator_id,user_id,billing_plan,amount_cents,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
    )
    .bind(id, creatorId, userId, plan, price.amountCents, now)
    .run();
  const session = await createStripeHostedCheckoutSession(
    {
      successUrl: `${env.SITE_ORIGIN || "https://tobaccoroadgames.com"}/account.html?identity_billing=success`,
      cancelUrl: `${env.SITE_ORIGIN || "https://tobaccoroadgames.com"}/account.html?identity_billing=canceled`,
      clientReferenceId: id,
      customerEmail: email,
      checkoutAttemptId: `identity-fee-${id}`,
      serviceType: "additional_creator_identity_fee",
      lineItems: [
        {
          currency: "USD",
          unitAmount: price.amountCents,
          name:
            plan === "monthly"
              ? "Tobacco Road Games — Additional Creator Identity (1 month)"
              : "Tobacco Road Games — Additional Creator Identity (1 year)",
        },
      ],
    },
    {
      secretKey: env.STRIPE_SECRET_KEY,
      pipelineStage: env.PAYMENT_PIPELINE_STAGE,
      idempotencyKey: `trg-identity-fee-${id}`,
      fetchImpl,
    },
  );
  await db
    .prepare(
      "UPDATE creator_identity_billing_attempts SET stripe_checkout_session_id=?,checkout_url=? WHERE id=?",
    )
    .bind(session.id, session.url, id)
    .run();
  return { checkoutUrl: session.url, billingAttemptId: id };
}

export async function settleStripeIdentityCoverage(
  db,
  {
    billingAttemptId,
    stripeCheckoutSessionId,
    stripePaymentIntentId,
    providerEventId,
    amountCents,
    currency,
    paymentStatus,
    nowMs = Date.now(),
  } = {},
) {
  const attempt = await db
    .prepare("SELECT * FROM creator_identity_billing_attempts WHERE id=?")
    .bind(String(billingAttemptId || ""))
    .first();
  if (!attempt) throw new Error("Identity billing attempt was not found.");
  const sku =
      attempt.billing_plan === "monthly"
        ? "additional_identity_monthly"
        : "additional_identity_annual",
    price = SERVICE_PRICING[sku];
  if (
    attempt.stripe_checkout_session_id !== stripeCheckoutSessionId ||
    !String(stripePaymentIntentId || "").startsWith("pi_") ||
    !String(providerEventId || "").startsWith("evt_") ||
    Number(amountCents) !== price.amountCents ||
    String(currency || "").toUpperCase() !== "USD" ||
    paymentStatus !== "paid"
  )
    throw new Error("Authoritative Stripe identity payment data is invalid.");
  const existing = attempt.service_purchase_id
    ? await db
        .prepare("SELECT * FROM marketplace_service_purchases WHERE id=?")
        .bind(attempt.service_purchase_id)
        .first()
    : null;
  if (existing) return { idempotent: true, servicePurchaseId: existing.id };
  if (attempt.status !== "pending")
    throw new Error("Identity billing attempt is not payable.");
  const latest = await db
      .prepare(
        "SELECT coverage_ends_at FROM creator_identity_coverage_periods WHERE creator_id=? AND status='active' ORDER BY coverage_ends_at DESC LIMIT 1",
      )
      .bind(attempt.creator_id)
      .first(),
    start = new Date(
      Math.max(nowMs, Date.parse(latest?.coverage_ends_at || "") || 0),
    ),
    end = addCoverageMonths(
      start,
      attempt.billing_plan === "annual_prepaid" ? 12 : 1,
    ),
    now = new Date(nowMs).toISOString(),
    servicePurchaseId = crypto.randomUUID(),
    coverageId = crypto.randomUUID(),
    key = `stripe-identity-fee:${attempt.id}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO marketplace_service_purchases(id,creator_id,user_id,service_type,service_sku,quantity,amount_cents,currency,payment_source,settlement_method,processor_fee_cents,status,stripe_checkout_session_id,idempotency_key,context_json,created_at,provider_event_id,provider_payment_reference,processor_fee_authoritative,completed_at) VALUES(?,?,?,'additional_creator_identity_fee',?,1,?,'USD','stripe','external_provider',0,'settled',?,?,?, ?,?,?,0,?)",
      )
      .bind(
        servicePurchaseId,
        attempt.creator_id,
        attempt.user_id,
        sku,
        price.amountCents,
        stripeCheckoutSessionId,
        key,
        JSON.stringify({ billingAttemptId: attempt.id, plan: attempt.billing_plan }),
        now,
        providerEventId,
        stripePaymentIntentId,
        now,
      ),
    db
      .prepare(
        "INSERT INTO marketplace_service_revenue_ledger(service_purchase_id,service_type,entry_type,amount_cents,currency,idempotency_key,created_at) VALUES(?,'additional_creator_identity_fee','service_revenue',?,'USD',?,?)",
      )
      .bind(servicePurchaseId, price.amountCents, `service-revenue:${key}`, now),
    db
      .prepare(
        "INSERT INTO creator_identity_coverage_periods(id,creator_id,service_purchase_id,billing_plan,coverage_starts_at,coverage_ends_at,payment_source,status,renewal_state,created_at) VALUES(?,?,?,?,?,?,'stripe','active','nonrenewing',?)",
      )
      .bind(
        coverageId,
        attempt.creator_id,
        servicePurchaseId,
        attempt.billing_plan,
        start.toISOString(),
        end.toISOString(),
        now,
      ),
    db
      .prepare(
        "UPDATE creator_identity_ownership SET billing_cadence=?,billing_status='current',entitlement_source='additional_paid',updated_at=? WHERE creator_id=? AND owner_user_id=? AND identity_type='additional'",
      )
      .bind(attempt.billing_plan, now, attempt.creator_id, attempt.user_id),
    db
      .prepare(
        "UPDATE creator_identity_billing_attempts SET status='paid',paid_at=?,service_purchase_id=? WHERE id=? AND status='pending'",
      )
      .bind(now, servicePurchaseId, attempt.id),
  ]);
  return {
    idempotent: false,
    servicePurchaseId,
    coverageStartsAt: start.toISOString(),
    coverageEndsAt: end.toISOString(),
  };
}

function addCoverageMonths(date, months) {
  const source = new Date(date),
    day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0),
  ).getUTCDate();
  source.setUTCDate(Math.min(day, last));
  return source;
}
