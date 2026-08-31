import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
import {
  getIdentityBillingState,
  startStripeIdentityCoverage,
} from "./creator-identity-billing.mjs";
import { getCreatorBalance } from "./creator-balance.mjs";
import { purchaseServiceWithCreatorBalance } from "./creator-service-purchases.mjs";
import { getCreatorTier } from "./marketplace-policy.mjs";
export const CREATOR_AGREEMENT = Object.freeze({
  id: "trg-creator-marketplace-agreement",
  version: "2026-08-27",
});
export async function handleCreatorRegistrationRequest(
  request,
  env = {},
  options = {},
) {
  const db = options.database || env.TRG_ORDERS,
    session = await getSessionFromRequest(
      request,
      env,
      options.sessionOptions || {},
    );
  if (!session.valid)
    return json(
      { error: { message: "Sign in before registering as a Creator." } },
      401,
    );
  if (request.method === "GET")
    return json(
      await registrationState(db, session.user.id, {
        nowMs: options.nowMs,
        pipelineStage: env.PAYMENT_PIPELINE_STAGE,
      }),
    );
  if (request.method !== "POST")
    return json({ error: { message: "Use GET or POST." } }, 405);
  if (
    !validateSameOriginRequest(request) ||
    !(await validateSessionCsrf(request, session)).valid
  )
    return json(
      { error: { message: "The registration request could not be verified." } },
      403,
    );
  let body = {};
  try {
    body = await request.json();
  } catch {}
  try {
    if (body.action === "accept_current_agreement") {
      const creatorId = String(body.creatorId || ""),
        owned = await db
          .prepare(
            "SELECT 1 ok FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=?",
          )
          .bind(creatorId, session.user.id)
          .first();
      if (!owned)
        return json({ error: { message: "Creator ownership is required." } }, 403);
      return json({
        ok: true,
        acceptance: await acceptCreatorAgreement(db, {
          creatorId,
          userId: session.user.id,
          sourceContext: "creator_onboarding",
          nowMs: options.nowMs,
        }),
      });
    }
    if (
      body.action === "purchase_identity_coverage" ||
      body.action === "purchase_identity_coverage_with_creator_balance"
    ) {
      const creatorId = String(body.creatorId || ""),
        plan = String(body.plan || ""),
        owned = await db
          .prepare(
            "SELECT identity_type FROM creator_identity_ownership WHERE creator_id=? AND owner_user_id=?",
          )
          .bind(creatorId, session.user.id)
          .first();
      if (!owned || owned.identity_type !== "additional")
        return json(
          { error: { message: "Additional Creator ownership is required." } },
          403,
        );
      if (body.action === "purchase_identity_coverage")
        return json({
          ok: true,
          ...(await startStripeIdentityCoverage(db, {
            creatorId,
            userId: session.user.id,
            plan,
            email: session.user.email_normalized,
            env,
            fetchImpl: options.fetchImpl,
            nowMs: options.nowMs,
          })),
        });
      if (body.paymentSource !== "creator_balance")
        throw new Error("Explicit Creator Balance payment selection is required.");
      const sku =
        plan === "monthly"
          ? "additional_identity_monthly"
          : plan === "annual_prepaid"
            ? "additional_identity_annual"
            : "";
      return json(
        {
          ok: true,
          ...(await purchaseServiceWithCreatorBalance(db, {
            creatorId,
            userId: session.user.id,
            sku,
            idempotencyKey: String(body.idempotencyKey || ""),
            nowMs: options.nowMs,
          })),
        },
        201,
      );
    }
    return json(
      {
        ok: true,
        ...(await registerPrimaryCreator(db, {
          userId: session.user.id,
          email: session.user.email_normalized,
          body,
          nowMs: options.nowMs,
        })),
      },
      201,
    );
  } catch (error) {
    return json({ error: { message: error.message } }, 409);
  }
}
export async function registerPrimaryCreator(
  db,
  { userId, email, body = {}, nowMs = Date.now() } = {},
) {
  if (
    await db
      .prepare(
        "SELECT 1 ok FROM creator_identity_ownership WHERE owner_user_id=? AND identity_type='primary'",
      )
      .bind(userId)
      .first()
  )
    throw new Error(
      "This account already has its free primary Creator identity.",
    );
  return createCreator(db, {
    userId,
    email,
    body,
    identityType: "primary",
    billingStatus: "not_required",
    entitlementSource: "primary_free",
    nowMs,
  });
}
export async function createAdditionalCreatorIdentity(
  db,
  {
    userId,
    email,
    body = {},
    billingCadence,
    nowMs = Date.now(),
  } = {},
) {
  if (!["monthly", "annual_prepaid"].includes(billingCadence))
    throw new Error("Choose monthly or annual prepaid identity billing.");
  if (
    !(await db
      .prepare(
        "SELECT 1 ok FROM creator_identity_ownership WHERE owner_user_id=? AND identity_type='primary'",
      )
      .bind(userId)
      .first())
  )
    throw new Error("Register the primary Creator identity first.");
  return createCreator(db, {
    userId,
    email,
    body,
    identityType: "additional",
    billingCadence,
    billingStatus: "pending",
    entitlementSource: "additional_paid",
    nowMs,
  });
}
export async function acceptCreatorAgreement(
  db,
  {
    creatorId,
    userId,
    agreementId = CREATOR_AGREEMENT.id,
    agreementVersion = CREATOR_AGREEMENT.version,
    sourceContext = "creator_registration",
    nowMs = Date.now(),
  } = {},
) {
  const now = new Date(nowMs).toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE creator_agreement_acceptances SET superseded_at=? WHERE creator_id=? AND agreement_id=? AND superseded_at IS NULL AND agreement_version<>?",
      )
      .bind(now, creatorId, agreementId, agreementVersion),
    db
      .prepare(
        "INSERT INTO creator_agreement_acceptances(creator_id,accepted_by_user_id,agreement_id,agreement_version,accepted_at,source_context) VALUES(?,?,?,?,?,?) ON CONFLICT(creator_id,agreement_id,agreement_version) DO UPDATE SET accepted_by_user_id=excluded.accepted_by_user_id,accepted_at=excluded.accepted_at,source_context=excluded.source_context,superseded_at=NULL",
      )
      .bind(
        creatorId,
        userId,
        agreementId,
        agreementVersion,
        now,
        String(sourceContext).slice(0, 100),
      ),
  ]);
  return { agreementId, agreementVersion, acceptedAt: now };
}
export async function getCreatorAccountReadiness(
  db,
  creatorId,
  { markInitialCompletion = false, nowMs = Date.now() } = {},
) {
  const creator = await db
    .prepare("SELECT * FROM marketplace_creators WHERE id=?")
    .bind(creatorId)
    .first();
  if (
    creator &&
    !Object.prototype.hasOwnProperty.call(creator, "registration_status")
  )
    return {
      eligible: creator.marketplace_status === "approved",
      reasonCodes: [],
      remediation: [],
      registrationComplete: creator.marketplace_status === "approved",
      historicallyCompleted: creator.marketplace_status === "approved",
      initialRegistrationPreviouslyCompleted:
        creator.marketplace_status === "approved",
      requirementsComplete: creator.marketplace_status === "approved",
      checks: { legacySchema: true },
      agreementCurrent: true,
      paymentMethodReady: true,
      payoutReady: true,
      identityEntitled: true,
      owner: null,
      creator,
    };
  const owner = await db
      .prepare("SELECT * FROM creator_identity_ownership WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    registration = await db
      .prepare("SELECT * FROM creator_registration_details WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    user = owner
      ? await db
          .prepare(
            "SELECT status,email_verified,email_normalized FROM users WHERE id=?",
          )
          .bind(owner.owner_user_id)
          .first()
      : null,
    agreement = await db
      .prepare(
        "SELECT 1 ok FROM creator_agreement_acceptances WHERE creator_id=? AND agreement_id=? AND agreement_version=? AND superseded_at IS NULL",
      )
      .bind(creatorId, CREATOR_AGREEMENT.id, CREATOR_AGREEMENT.version)
      .first(),
    payment = owner
      ? await db
          .prepare(
            "SELECT legal_name,payment_method_status FROM user_account_profiles WHERE user_id=?",
          )
          .bind(owner.owner_user_id)
          .first()
      : null,
    payout = await db
      .prepare(
        "SELECT onboarding_status,verification_status,payouts_enabled FROM creator_payout_profiles WHERE creator_id=?",
      )
      .bind(creatorId)
      .first(),
    audit = await optionalFirst(
      db,
      "SELECT state FROM creator_account_audit_states WHERE creator_id=?",
      [creatorId],
    ),
    identityBilling = await getIdentityBillingState(db, creatorId, nowMs);
  const checks = {
      customerAccountComplete: Boolean(
        user?.status === "active" &&
        Number(user?.email_verified) === 1 &&
        /^\S+@\S+\.\S+$/.test(user?.email_normalized || "") &&
        payment?.legal_name,
      ),
      creatorPublicComplete: Boolean(
        creator?.marketplace_status === "approved" &&
          creator.slug &&
          creator.display_name &&
          creator.short_bio,
      ),
      creatorDetailsComplete: hasRequiredCreatorRegistration(registration),
      agreementCurrent: Boolean(agreement),
      paymentMethodReady: payment?.payment_method_status === "ready",
      payoutReady: Boolean(
        payout?.onboarding_status === "complete" &&
        payout?.verification_status === "verified" &&
        Number(payout?.payouts_enabled) === 1,
      ),
      identityEntitled: Boolean(
        owner?.account_status === "active" &&
          identityBilling.active,
      ),
      creatorAccountOperational: Boolean(
        !["restricted", "suspended"].includes(creator?.registration_status),
      ),
      auditOperational: audit?.state !== "restricted",
    },
    requirementsComplete = Object.values(checks).every(Boolean),
    completionFieldAvailable = Object.prototype.hasOwnProperty.call(
      creator || {},
      "intake_registration_completed_at",
    ),
    previouslyCompleted = Boolean(
      completionFieldAvailable
        ? creator?.intake_registration_completed_at
        : creator?.registration_completed_at,
    ),
    registrationComplete = requirementsComplete;
  if (markInitialCompletion && requirementsComplete && !previouslyCompleted) {
    const completedAt = new Date(nowMs).toISOString();
    await db
      .prepare(
        completionFieldAvailable
          ? "UPDATE marketplace_creators SET registration_status='active',registration_completed_at=COALESCE(registration_completed_at,?),intake_registration_completed_at=?,updated_at=? WHERE id=? AND intake_registration_completed_at IS NULL"
          : "UPDATE marketplace_creators SET registration_status='active',registration_completed_at=?,updated_at=? WHERE id=? AND registration_completed_at IS NULL",
      )
      .bind(
        ...(completionFieldAvailable
          ? [completedAt, completedAt, completedAt, creatorId]
          : [completedAt, completedAt, creatorId]),
      )
      .run();
    creator.registration_status = "active";
    creator.registration_completed_at = completedAt;
    if (completionFieldAvailable)
      creator.intake_registration_completed_at = completedAt;
    try {
      await db
        .prepare(
          "UPDATE creator_account_audit_states SET audit_anchor_at=?,next_audit_due_at=?,updated_at=? WHERE creator_id=? AND state='scheduled'",
        )
        .bind(completedAt, sixMonthsAfter(completedAt), completedAt, creatorId)
        .run();
    } catch (error) {
      if (!/no such table:\s*creator_account_audit_states/i.test(String(error)))
        throw error;
    }
  }
  return {
    eligible: requirementsComplete,
    reasonCodes: eligibilityReasonCodes(checks),
    remediation: eligibilityRemediation(checks),
    registrationComplete,
    historicallyCompleted: previouslyCompleted,
    initialRegistrationPreviouslyCompleted: previouslyCompleted,
    requirementsComplete,
    checks,
    agreementCurrent: Boolean(agreement),
    paymentMethodReady: payment?.payment_method_status === "ready",
    payoutReady: Boolean(
      payout?.onboarding_status === "complete" &&
      payout?.verification_status === "verified" &&
      Number(payout?.payouts_enabled) === 1,
    ),
    identityEntitled: Boolean(
      owner?.account_status === "active" &&
        identityBilling.active,
    ),
    identityBilling,
    owner,
    creator,
  };
}
export async function getCreatorOperationalEligibility(
  db,
  creatorId,
  options = {},
) {
  const readiness = await getCreatorAccountReadiness(db, creatorId, options);
  return {
    ...readiness,
    eligible: readiness.requirementsComplete,
    currentEligibilityEvaluatedAt: new Date(
      options.nowMs || Date.now(),
    ).toISOString(),
  };
}
function eligibilityReasonCodes(checks) {
  const names = {
    customerAccountComplete: "account_or_email_required",
    creatorPublicComplete: "creator_profile_required",
    creatorDetailsComplete: "creator_details_required",
    agreementCurrent: "agreement_update_required",
    paymentMethodReady: "payment_method_required",
    payoutReady: "connect_or_payout_readiness_required",
    identityEntitled: "creator_identity_inactive",
    creatorAccountOperational: "creator_account_restricted",
    auditOperational: "account_remediation_required",
  };
  return Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => names[key] || "creator_eligibility_required");
}
function eligibilityRemediation(checks) {
  const links = [];
  if (
    !checks.customerAccountComplete ||
    !checks.creatorDetailsComplete ||
    !checks.agreementCurrent ||
    !checks.paymentMethodReady ||
    !checks.identityEntitled
  )
    links.push({
      category: "account",
      href: "/account#creator-registration-panel",
    });
  if (!checks.creatorPublicComplete)
    links.push({ category: "profile", href: "/creator/#creator-profile" });
  if (!checks.payoutReady)
    links.push({ category: "connect", href: "/creator/#creator-finance" });
  if (!checks.auditOperational || !checks.creatorAccountOperational)
    links.push({
      category: "account_remediation",
      href: "/creator/#creator-remediations",
    });
  return links;
}
async function optionalFirst(db, sql, values) {
  try {
    return await db.prepare(sql).bind(...values).first();
  } catch (error) {
    if (/no such table/i.test(String(error))) return null;
    throw error;
  }
}
function hasRequiredCreatorRegistration(registration) {
  return Boolean(
    registration?.legal_name &&
    registration.business_type &&
    registration.country &&
    registration.state_region &&
    registration.address_line1 &&
    registration.city &&
    registration.postal_code &&
    /^\S+@\S+\.\S+$/.test(registration.contact_email || "") &&
    registration.rights_confirmation_at,
  );
}
function sixMonthsAfter(value) {
  const source = new Date(value),
    targetMonth = source.getUTCMonth() + 6,
    targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12),
    normalizedMonth = ((targetMonth % 12) + 12) % 12,
    lastDay = new Date(
      Date.UTC(targetYear, normalizedMonth + 1, 0),
    ).getUTCDate();
  source.setUTCFullYear(
    targetYear,
    normalizedMonth,
    Math.min(source.getUTCDate(), lastDay),
  );
  return source.toISOString();
}
async function createCreator(
  db,
  {
    userId,
    email,
    body,
    identityType,
    billingCadence = null,
    billingStatus,
    entitlementSource,
    nowMs,
  },
) {
  const fields = registrationFields(body, email);
  if (fields.error) throw new Error(fields.error);
  if (body.acceptAgreement !== true || body.confirmRights !== true)
    throw new Error(
      "Creator Agreement and seller-rights confirmations are required.",
    );
  const slug = slugify(body.slug || body.creatorName),
    existing = await db
      .prepare("SELECT 1 ok FROM marketplace_creators WHERE slug=?")
      .bind(slug)
      .first();
  if (!slug || existing)
    throw new Error("Creator handle is invalid or unavailable.");
  const id = crypto.randomUUID(),
    now = new Date(nowMs || Date.now()).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO marketplace_creators(id,slug,display_name,profile_image,logo,banner_image,short_bio,links_json,marketplace_status,registration_status,registration_completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'approved','incomplete',NULL,?,?)`,
      )
      .bind(
        id,
        slug,
        fields.creatorName,
        fields.logo,
        fields.logo,
        fields.banner,
        fields.shortBio,
        JSON.stringify(fields.links),
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO user_account_profiles(user_id,legal_name,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET legal_name=CASE WHEN user_account_profiles.legal_name='' THEN excluded.legal_name ELSE user_account_profiles.legal_name END,updated_at=excluded.updated_at",
      )
      .bind(userId, fields.legalName, now, now),
    db
      .prepare(
        "INSERT INTO creator_memberships(user_id,creator_id,permission,created_at) VALUES(?,?,'manager',?)",
      )
      .bind(userId, id, now),
    db
      .prepare(
        "INSERT INTO creator_identity_ownership(creator_id,owner_user_id,identity_type,account_status,billing_cadence,billing_status,entitlement_source,created_at,updated_at) VALUES(?,?,?,'active',?,?,?,?,?)",
      )
      .bind(
        id,
        userId,
        identityType,
        billingCadence,
        billingStatus,
        entitlementSource,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO creator_registration_details(creator_id,legal_name,business_name,business_type,country,state_region,address_line1,address_line2,city,postal_code,contact_email,phone,rights_confirmation_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        fields.legalName,
        fields.businessName,
        fields.businessType,
        fields.country,
        fields.stateRegion,
        fields.address1,
        fields.address2,
        fields.city,
        fields.postalCode,
        fields.contactEmail,
        fields.phone,
        now,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO creator_payout_profiles(creator_id,status_updated_at) VALUES(?,?)",
      )
      .bind(id, now),
  ]);
  await acceptCreatorAgreement(db, {
    creatorId: id,
    userId,
    nowMs: nowMs || Date.now(),
  });
  return {
    creatorId: id,
    slug,
    identityType,
    registrationStatus: "incomplete",
    payoutStatus: "not_started",
    paymentMethodStatus: "missing",
  };
}
async function registrationState(
  db,
  userId,
  { nowMs = Date.now(), pipelineStage = "" } = {},
) {
  const owned = await rows(
    db
      .prepare(
        `SELECT o.*,c.slug,c.display_name,c.registration_status FROM creator_identity_ownership o JOIN marketplace_creators c ON c.id=o.creator_id WHERE o.owner_user_id=? ORDER BY o.identity_type DESC,c.created_at`,
      )
      .bind(userId),
  );
  const ownedCreators = [];
  for (const creator of owned) {
    const readiness = await getCreatorAccountReadiness(db, creator.creator_id, {
      markInitialCompletion: true,
      nowMs,
    });
    const billing = await getIdentityBillingState(
        db,
        creator.creator_id,
        nowMs,
      ),
      balance = await optionalCreatorBalance(db, {
        creatorId: creator.creator_id,
        userId,
        nowMs,
      }),
      tier = await getCreatorTier(db, creator.creator_id, nowMs);
    ownedCreators.push({
      id: creator.creator_id,
      slug: creator.slug,
      displayName: creator.display_name,
      identityType: creator.identity_type,
      identity_type: creator.identity_type,
      registrationComplete: readiness.registrationComplete,
      currentlyEligible: readiness.eligible,
      historicallyCompleted: readiness.historicallyCompleted,
      eligibilityReasons: readiness.reasonCodes,
      remediation: readiness.remediation,
      checks: readiness.checks,
      paymentMethodReady: readiness.paymentMethodReady,
      payoutReady: readiness.payoutReady,
      identityBilling: billing,
      creatorBalanceAvailableCents: balance.availableCents,
      preferred: {
        active: tier.preferred,
        termEndsAt: tier.term?.term_ends_at || null,
      },
    });
  }
  return {
    agreement: CREATOR_AGREEMENT,
    ownedCreators,
    paymentCollection: {
      hostedByStripe: true,
      available: false,
      staging: String(pipelineStage || "").toLowerCase() === "staging",
    },
  };
}

async function optionalCreatorBalance(db, input) {
  try {
    return await getCreatorBalance(db, input);
  } catch (error) {
    if (/no such table|has no column/i.test(String(error?.message || error))) {
      return { availableCents: 0 };
    }
    throw error;
  }
}
function registrationFields(b, email) {
  const f = {
    creatorName: text(b.creatorName, 80),
    shortBio: text(b.shortBio, 500),
    logo: url(b.logo),
    banner: url(b.banner),
    legalName: text(b.legalName, 160),
    businessName: text(b.businessName, 160),
    businessType: text(b.businessType, 80),
    country: text(b.country, 2).toUpperCase(),
    stateRegion: text(b.stateRegion, 100),
    address1: text(b.addressLine1, 200),
    address2: text(b.addressLine2, 200),
    city: text(b.city, 100),
    postalCode: text(b.postalCode, 30),
    contactEmail: text(b.contactEmail || email, 254).toLowerCase(),
    phone: text(b.phone, 40),
    links: Array.isArray(b.links)
      ? b.links
          .slice(0, 10)
          .filter((x) => url(x?.url))
          .map((x) => ({ label: text(x.label, 60), url: url(x.url) }))
      : [],
  };
  if (
    !f.creatorName ||
    !f.shortBio ||
    !f.legalName ||
    !f.businessType ||
    f.country.length !== 2 ||
    !f.stateRegion ||
    !f.address1 ||
    !f.city ||
    !f.postalCode ||
    !/^\S+@\S+\.\S+$/.test(f.contactEmail) ||
    f.logo === null ||
    f.banner === null
  )
    return {
      error: "Required Creator registration information is incomplete.",
    };
  return f;
}
function slugify(v) {
  return text(v, 100)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function text(v, n) {
  return String(v || "")
    .trim()
    .slice(0, n);
}
function url(v) {
  const x = text(v, 500);
  if (!x) return "";
  if (x.startsWith("/")) return x;
  try {
    const u = new URL(x);
    return ["https:", "http:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
async function rows(s) {
  const r = await s.all();
  return r.results || [];
}
function json(x, s = 200) {
  return new Response(JSON.stringify(x), {
    status: s,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json",
    },
  });
}
