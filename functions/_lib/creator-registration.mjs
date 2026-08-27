import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
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
    return json(await registrationState(db, session.user.id));
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
    billingStatus,
    nowMs = Date.now(),
  } = {},
) {
  if (
    !["monthly", "annual_prepaid"].includes(billingCadence) ||
    billingStatus !== "current"
  )
    throw new Error("Additional Creator identity billing is not current.");
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
    billingStatus,
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
export async function getCreatorAccountReadiness(db, creatorId) {
  const creator = await db
      .prepare("SELECT * FROM marketplace_creators WHERE id=?")
      .bind(creatorId)
      .first(),
    owner = await db
      .prepare("SELECT * FROM creator_identity_ownership WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    registration = await db
      .prepare("SELECT * FROM creator_registration_details WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    agreement = await db
      .prepare(
        "SELECT 1 ok FROM creator_agreement_acceptances WHERE creator_id=? AND agreement_id=? AND agreement_version=? AND superseded_at IS NULL",
      )
      .bind(creatorId, CREATOR_AGREEMENT.id, CREATOR_AGREEMENT.version)
      .first(),
    payment = owner
      ? await db
          .prepare(
            "SELECT payment_method_status FROM user_account_profiles WHERE user_id=?",
          )
          .bind(owner.owner_user_id)
          .first()
      : null,
    payout = await db
      .prepare(
        "SELECT onboarding_status,verification_status,payouts_enabled FROM creator_payout_profiles WHERE creator_id=?",
      )
      .bind(creatorId)
      .first();
  return {
    registrationComplete: Boolean(
      creator?.registration_status === "active" && registration,
    ),
    agreementCurrent: Boolean(agreement),
    paymentMethodReady: payment?.payment_method_status === "ready",
    payoutReady: Boolean(
      payout?.onboarding_status === "complete" &&
      payout?.verification_status === "verified" &&
      Number(payout?.payouts_enabled) === 1,
    ),
    identityEntitled: Boolean(
      owner?.account_status === "active" &&
      (owner.identity_type === "primary" ||
        ["current", "legacy_grandfathered"].includes(owner.billing_status)),
    ),
    owner,
    creator,
  };
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
        `INSERT INTO marketplace_creators(id,slug,display_name,profile_image,logo,banner_image,short_bio,links_json,marketplace_status,registration_status,registration_completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'approved','active',?,?,?)`,
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
        now,
      ),
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
    registrationStatus: "active",
    payoutStatus: "not_started",
    paymentMethodStatus: "missing",
  };
}
async function registrationState(db, userId) {
  const owned = await rows(
    db
      .prepare(
        `SELECT o.*,c.slug,c.display_name,c.registration_status FROM creator_identity_ownership o JOIN marketplace_creators c ON c.id=o.creator_id WHERE o.owner_user_id=? ORDER BY o.identity_type DESC,c.created_at`,
      )
      .bind(userId),
  );
  return { agreement: CREATOR_AGREEMENT, ownedCreators: owned };
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
