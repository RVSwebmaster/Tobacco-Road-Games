import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { activatePendingCustomer, customerFields, saveCustomerRegistration, validateCustomerRegistration } from "./customer-registration.mjs";

export async function handleAccountProfileRequest(request, env = {}, options = {}) {
  const db = options.database || env.TRG_ORDERS;
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return json({ error: { message: "Sign in to manage your account." } }, 401);
  if (request.method === "GET") return json(await privateProfile(db, session.user));
  if (request.method !== "POST") return json({ error: { message: "Use GET or POST." } }, 405);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return json({ error: { message: "The account request could not be verified." } }, 403);
  }

  let body = {};
  try { body = await request.json(); } catch {}
  const now = new Date(options.nowMs || Date.now()).toISOString();
  const birthday = date(body.birthday);
  const avatar = safeUrl(body.avatarUrl);
  const preferences = preferencesJson(body.notificationPreferences);
  if ((body.birthday && birthday === null) || avatar === null || preferences === null) {
    return json({ error: { message: "Account profile fields are invalid." } }, 400);
  }
  const registrationState = await db.prepare("SELECT state FROM customer_registration_states WHERE user_id=?").bind(session.user.id).first();
  const isPendingCustomer = registrationState?.state === "pending";
  if (isPendingCustomer || hasCustomerFields(body)) {
    const validated = validateCustomerRegistration(body);
    if (!validated.valid) {
      return json({ error: { message: "Complete the required Customer profile, billing, and agreement fields. Phone numbers are not collected." } }, 400);
    }
    await saveCustomerRegistration(db, session.user.id, body, now);
  }

  const existing = await db.prepare("SELECT * FROM user_account_profiles WHERE user_id=?").bind(session.user.id).first();
  await db.prepare(`INSERT INTO user_account_profiles(
      user_id,legal_name,birthday,display_name,avatar_url,notification_preferences_json,
      billing_first_name,billing_last_name,billing_company,billing_address_line1,
      billing_address_line2,billing_city,billing_state_region,billing_postal_code,billing_country,
      stripe_customer_reference,default_payment_method_reference,payment_card_brand,payment_card_last4,
      payment_method_status,payment_method_status_updated_at,customer_activated_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET legal_name=excluded.legal_name,birthday=excluded.birthday,
      display_name=excluded.display_name,avatar_url=excluded.avatar_url,
      notification_preferences_json=excluded.notification_preferences_json,
      billing_first_name=excluded.billing_first_name,billing_last_name=excluded.billing_last_name,
      billing_company=excluded.billing_company,billing_address_line1=excluded.billing_address_line1,
      billing_address_line2=excluded.billing_address_line2,billing_city=excluded.billing_city,
      billing_state_region=excluded.billing_state_region,billing_postal_code=excluded.billing_postal_code,
      billing_country=excluded.billing_country,updated_at=excluded.updated_at`).bind(
    session.user.id, clean(body.legalName ?? existing?.legal_name, 160), birthday ?? existing?.birthday ?? null,
    clean(body.displayName ?? existing?.display_name, 80), avatar || existing?.avatar_url || "",
    preferences ?? existing?.notification_preferences_json ?? "{}",
    clean(body.firstName ?? existing?.billing_first_name, 100), clean(body.lastName ?? existing?.billing_last_name, 100),
    clean(body.company ?? existing?.billing_company, 160), clean(body.addressLine1 ?? existing?.billing_address_line1, 200),
    clean(body.addressLine2 ?? existing?.billing_address_line2, 200), clean(body.city ?? existing?.billing_city, 100),
    clean(body.stateRegion ?? existing?.billing_state_region, 100), clean(body.postalCode ?? existing?.billing_postal_code, 30),
    clean(body.country ?? existing?.billing_country, 2).toUpperCase(), existing?.stripe_customer_reference || "",
    existing?.default_payment_method_reference || "", existing?.payment_card_brand || "", existing?.payment_card_last4 || "",
    existing?.payment_method_status || "missing", existing?.payment_method_status_updated_at || null,
    existing?.customer_activated_at || null, existing?.created_at || now, now,
  ).run();
  if (isPendingCustomer) await activatePendingCustomer(db, session.user.id, now);
  const refreshedUser = await db.prepare("SELECT * FROM users WHERE id=?").bind(session.user.id).first();
  return json({ ok: true, ...await privateProfile(db, refreshedUser) });
}

export async function recordPaymentMethodReadiness(db, {
  userId, stripeCustomerReference, paymentMethodReference, brand = "", last4 = "", status, nowMs = Date.now(),
} = {}) {
  if (!["missing", "pending", "ready", "expired", "restricted"].includes(status)) throw new Error("Payment-method status is invalid.");
  if (status === "ready" && (!String(stripeCustomerReference).startsWith("cus_") || !String(paymentMethodReference).startsWith("pm_"))) {
    throw new Error("Ready payment methods require safe Stripe references.");
  }
  const now = new Date(nowMs).toISOString();
  await db.prepare(`INSERT INTO user_account_profiles(user_id,stripe_customer_reference,default_payment_method_reference,
      payment_card_brand,payment_card_last4,payment_method_status,payment_method_status_updated_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_reference=excluded.stripe_customer_reference,
      default_payment_method_reference=excluded.default_payment_method_reference,payment_card_brand=excluded.payment_card_brand,
      payment_card_last4=excluded.payment_card_last4,payment_method_status=excluded.payment_method_status,
      payment_method_status_updated_at=excluded.payment_method_status_updated_at,updated_at=excluded.updated_at`)
    .bind(String(userId), String(stripeCustomerReference || ""), String(paymentMethodReference || ""), clean(brand, 30),
      /^\d{4}$/.test(String(last4)) ? String(last4) : "", status, now, now, now).run();
  return { userId, status };
}

async function privateProfile(db, user) {
  const profile = await db.prepare("SELECT * FROM user_account_profiles WHERE user_id=?").bind(user.id).first();
  const methods = await all(db.prepare(`SELECT payment_method_reference AS id,cardholder_name AS cardholderName,
    card_brand AS brand,card_last4 AS last4,expiration_month AS expirationMonth,
    expiration_year AS expirationYear,state,created_at AS createdAt
    FROM customer_saved_payment_methods WHERE user_id=? AND state='active' ORDER BY created_at`).bind(user.id));
  const consents = await db.prepare("SELECT terms_version,privacy_version FROM customer_registration_consents WHERE user_id=?").bind(user.id).first();
  const registration = await db.prepare("SELECT state,activated_at FROM customer_registration_states WHERE user_id=?").bind(user.id).first();
  return { user: {
    id: user.id, email: user.email_normalized, emailVerified: Boolean(user.email_verified),
    role: user.role, customerPrivilegesActive: !registration || registration.state === "active",
    customerActivatedAt: registration?.activated_at || profile?.customer_activated_at || null,
    legalName: profile?.legal_name || "", birthday: profile?.birthday || null,
    displayName: profile?.display_name || "", avatarUrl: profile?.avatar_url || "",
    notificationPreferences: parseJson(profile?.notification_preferences_json),
    billing: {
      firstName: profile?.billing_first_name || "", lastName: profile?.billing_last_name || "",
      company: profile?.billing_company || "", addressLine1: profile?.billing_address_line1 || "",
      addressLine2: profile?.billing_address_line2 || "", city: profile?.billing_city || "",
      stateRegion: profile?.billing_state_region || "", postalCode: profile?.billing_postal_code || "",
      country: profile?.billing_country || "",
    },
    paymentMethod: { status: profile?.payment_method_status || "missing", brand: profile?.payment_card_brand || "",
      last4: profile?.payment_card_last4 || "", methods, defaultId: profile?.default_payment_method_reference || "" },
    agreements: { termsVersion: consents?.terms_version || "", privacyVersion: consents?.privacy_version || "" },
  } };
}

function hasCustomerFields(body) { return ["firstName", "lastName", "addressLine1", "city", "stateRegion", "postalCode", "country", "acceptTerms", "acknowledgePrivacy"].some((key) => body[key] !== undefined); }
function clean(value, max) { return String(value || "").trim().slice(0, max); }
function date(value) { if (!value) return null; return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : null; }
function safeUrl(value) { const input = clean(value, 500); if (!input) return ""; if (input.startsWith("/")) return input; try { const parsed = new URL(input); return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : null; } catch { return null; } }
function preferencesJson(value) { if (value === undefined) return null; if (!value || typeof value !== "object" || Array.isArray(value)) return null; return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key, entry]) => /^[a-z][a-z0-9_]{0,40}$/i.test(key) && typeof entry === "boolean").slice(0, 20))); }
function parseJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
async function all(statement) { const result = await statement.all(); return result.results || []; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "cache-control": "private, no-store", "content-type": "application/json" } }); }
