import { getCustomerSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { resolveMemberProfileAccess } from "./member-profile-access.mjs";
import { STRIPE_API_VERSION } from "./stripe-api.mjs";
import { validateStripeKey } from "./stripe-checkout.mjs";

const STRIPE = "https://api.stripe.com/v1";

export async function handleCustomerPaymentMethods(request, env = {}, options = {}) {
  const session = await (options.getSession || getCustomerSessionFromRequest)(request, env, options.sessionOptions || {});
  if (!session.valid) return json({ error: { message: "Sign in to manage payment methods." } }, 401);
  const access = await (options.resolveAccess || resolveMemberProfileAccess)(options.database || env.TRG_ORDERS, session.user);
  if (access.accountClass !== "customer") return json({ error: { message: "Customer payment settings are unavailable for this account." } }, 403);
  if (request.method === "GET") return readPaymentMethods(env, session.user, options);
  if (request.method !== "POST") return json({ error: { message: "Use GET or POST." } }, 405);
  if (!(options.validateOrigin || validateSameOriginRequest)(request) || !(await (options.validateCsrf || validateSessionCsrf)(request, session)).valid) {
    return json({ error: { message: "The payment request could not be verified." } }, 403);
  }
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const purpose = body?.purpose === "billing_address" ? "billing_address" : body?.purpose === "payment_methods" ? "payment_methods" : null;
  if (!purpose) return json({ error: { message: "Choose a supported payment-management action." } }, 400);
  try {
    const { key, livemode } = validateStripeKey(env.STRIPE_SECRET_KEY, env.PAYMENT_PIPELINE_STAGE);
    const db = options.database || env.TRG_ORDERS;
    let row = await db.prepare("SELECT stripe_customer_reference FROM customer_stripe_accounts WHERE user_id=?").bind(session.user.id).first();
    if (!row) {
      const customer = await stripe(key, "customers", {
        email: session.user.email_normalized,
        "metadata[trg_user_id]": session.user.id,
      }, `trg-customer-payment-${session.user.id}`, options.fetchImpl);
      if (customer.livemode !== livemode || !String(customer.id || "").startsWith("cus_")) throw new Error("Stripe customer response invalid");
      await db.prepare("INSERT INTO customer_stripe_accounts(user_id,stripe_customer_reference,created_at,updated_at) VALUES(?,?,?,?)")
        .bind(session.user.id, customer.id, new Date(options.nowMs || Date.now()).toISOString(), new Date(options.nowMs || Date.now()).toISOString()).run();
      row = { stripe_customer_reference: customer.id };
    }
    const config = await getPortalConfiguration(db, key, livemode, { ...options, publicSiteOrigin: env.PUBLIC_SITE_ORIGIN || options.publicSiteOrigin });
    const params = new URLSearchParams({ customer: row.stripe_customer_reference, configuration: config, return_url: `${new URL(request.url).origin}/customer-profile/?payment_methods=returned#payment-methods` });
    params.set("flow_data[type]", purpose === "billing_address" ? "customer_update" : "payment_method_update");
    const portal = await stripe(key, "billing_portal/sessions", params, `trg-customer-portal-${session.user.id}-${purpose}-${options.nowMs || Date.now()}`, options.fetchImpl);
    if (portal.livemode !== livemode || typeof portal.url !== "string" || !portal.url.startsWith("https://billing.stripe.com/")) throw new Error("Stripe portal response invalid");
    return json({ ok: true, url: portal.url });
  } catch (error) {
    console.error("Customer payment management request failed", { stripeStatus: error?.stripeStatus || error?.httpStatus || null, stripeCode: error?.stripeCode || error?.code || null });
    return json({ error: { message: "Secure payment management is temporarily unavailable. Your purchases remain available without saving a payment method." } }, 503);
  }
}

async function readPaymentMethods(env, user, options) {
  try {
    const { key, livemode } = validateStripeKey(env.STRIPE_SECRET_KEY, env.PAYMENT_PIPELINE_STAGE);
    const db = options.database || env.TRG_ORDERS;
    const row = await db.prepare("SELECT stripe_customer_reference FROM customer_stripe_accounts WHERE user_id=?").bind(user.id).first();
    if (!row) return json({ methods: [], billingAddress: null, status: "empty" });
    const [customer, methods] = await Promise.all([
      stripe(key, `customers/${encodeURIComponent(row.stripe_customer_reference)}`, null, null, options.fetchImpl),
      stripe(key, `payment_methods?customer=${encodeURIComponent(row.stripe_customer_reference)}&type=card&limit=100`, null, null, options.fetchImpl),
    ]);
    if (customer.livemode !== livemode || !Array.isArray(methods.data)) throw new Error("Stripe response invalid");
    const defaultId = customer.invoice_settings?.default_payment_method;
    return json({
      status: "ready",
      methods: methods.data.filter((item) => item?.type === "card" && item.card).map((item) => ({
        brand: safeText(item.card.brand, 24), last4: /^\d{4}$/.test(item.card.last4 || "") ? item.card.last4 : "",
        expMonth: integer(item.card.exp_month, 1, 12), expYear: integer(item.card.exp_year, 2000, 2200), isDefault: item.id === defaultId,
      })),
      billingAddress: safeAddress(customer.address),
    });
  } catch {
    return json({ status: "unavailable", methods: [], billingAddress: null, error: { message: "Saved payment information could not be loaded." } }, 503);
  }
}

async function getPortalConfiguration(db, key, livemode, options) {
  const mode = livemode ? "live" : "test";
  const existing = await db.prepare("SELECT configuration_reference FROM customer_payment_portal_configurations WHERE stripe_mode=?").bind(mode).first();
  if (existing) return existing.configuration_reference;
  const config = await stripe(key, "billing_portal/configurations", {
    "features[payment_method_update][enabled]": "true",
    "features[customer_update][enabled]": "true",
    "features[customer_update][allowed_updates][0]": "address",
    "features[invoice_history][enabled]": "false",
    "business_profile[privacy_policy_url]": new URL("/privacy.html", options.publicSiteOrigin || "https://tobaccoroadgames.com").toString(),
    "business_profile[terms_of_service_url]": new URL("/terms.html", options.publicSiteOrigin || "https://tobaccoroadgames.com").toString(),
  }, `trg-customer-portal-config-${mode}-v1`, options.fetchImpl);
  if (!String(config.id || "").startsWith("bpc_") || config.livemode !== livemode) throw new Error("Stripe portal configuration invalid");
  const now = new Date(options.nowMs || Date.now()).toISOString();
  await db.prepare("INSERT INTO customer_payment_portal_configurations(stripe_mode,configuration_reference,created_at,updated_at) VALUES(?,?,?,?)")
    .bind(mode, config.id, now, now).run();
  return config.id;
}

async function stripe(key, path, form, idempotencyKey, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${STRIPE}/${path}`, {
    method: form ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "stripe-version": STRIPE_API_VERSION, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    ...(form ? { body: form instanceof URLSearchParams ? form : new URLSearchParams(form) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    const error = new Error("Stripe request failed");
    error.stripeStatus = Number(response.status) || null;
    error.stripeCode = /^[a-z0-9_]{1,64}$/i.test(payload?.error?.code || "") ? payload.error.code : null;
    throw error;
  }
  return payload;
}

function safeAddress(address) {
  if (!address) return null;
  return Object.fromEntries(["line1", "line2", "city", "state", "postal_code", "country"].map((key) => [key, safeText(address[key], 120)]).filter(([, value]) => value));
}
function safeText(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function integer(value, min, max) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : null; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "cache-control": "private, no-store", "content-type": "application/json" } }); }
