import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { activatePendingCustomer } from "./customer-registration.mjs";
import { validateStripeKey } from "./stripe-checkout.mjs";
import { STRIPE_API_VERSION } from "./stripe-api.mjs";

const STRIPE_API = "https://api.stripe.com/v1";

export async function handleCustomerPaymentMethodsRequest(request, env = {}, options = {}) {
  const db = options.database || env.TRG_ORDERS;
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return json({ error: { message: "Sign in to manage saved cards." } }, 401);
  if (request.method === "GET") {
    await hydrateLegacyPaymentMethodDetails(db, session.user.id, env, options);
    return json(await listPaymentMethods(db, session.user.id));
  }
  if (request.method !== "POST") return json({ error: { message: "Use GET or POST." } }, 405);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return json({ error: { message: "The payment-method request could not be verified." } }, 403);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  // Never accept PAN or CVC-shaped values through a TRG request.
  if (Object.keys(body).some((key) => /card(number|_?number)|cvc|cvv|security(code|_?code)/i.test(key))) {
    return json({ error: { message: "Card details must be entered in the secure Stripe form." } }, 400);
  }
  try {
    switch (String(body.action || "")) {
      case "create_setup": return json(await createSetup(db, session.user, env, body, options));
      case "confirm_setup": return json(await confirmSetup(db, session.user, env, body, options));
      case "set_default": return json(await setDefault(db, session.user.id, body.paymentMethodId, options));
      case "remove": return json(await removePaymentMethod(db, session.user.id, env, body.paymentMethodId, options));
      default: return json({ error: { message: "Choose a supported saved-card action." } }, 400);
    }
  } catch (error) {
    const status = error?.httpStatus || 400;
    return json({ error: { message: publicError(error) } }, status);
  }
}

async function createSetup(db, user, env, body, options) {
  if (body.savePaymentMethod !== true) throw new PaymentMethodError("Authorize saving this card before continuing.", 400);
  const attemptId = safeAttemptId(body.idempotencyKey);
  const stripe = stripeSettings(env);
  const profile = await db.prepare("SELECT * FROM user_account_profiles WHERE user_id=?").bind(user.id).first();
  const consents = await db.prepare("SELECT 1 AS accepted FROM customer_registration_consents WHERE user_id=?").bind(user.id).first();
  if (!profile || !profile.display_name || !profile.billing_first_name || !profile.billing_last_name ||
      !profile.billing_address_line1 || !profile.billing_city || !profile.billing_state_region ||
      !profile.billing_postal_code || !/^[A-Z]{2}$/.test(profile.billing_country || "") || !consents) {
    throw new PaymentMethodError("Save your required Customer profile, billing details, and account agreements first.", 409);
  }
  const current = await db.prepare("SELECT * FROM customer_payment_setup_attempts WHERE id=?").bind(attemptId).first();
  if (current && current.user_id !== user.id) throw new PaymentMethodError("That payment setup attempt is unavailable.", 409);
  const now = new Date(options.nowMs || Date.now()).toISOString();
  if (!current) {
    await db.prepare(`INSERT INTO customer_payment_setup_attempts(id,user_id,state,created_at,updated_at)
      VALUES(?,?,'creating',?,?)`).bind(attemptId, user.id, now, now).run();
    await db.prepare(`INSERT INTO customer_payment_method_authorizations(id,user_id,authorization_scope,accepted_at,created_at)
      VALUES(?,?,'save_payment_method',?,?)`).bind(`save_${attemptId}`, user.id, now, now).run();
  }
  const customerId = profile.stripe_customer_reference || await createStripeCustomer(db, user, profile, stripe, options);
  let intent;
  if (current?.stripe_setup_intent_reference) {
    intent = await stripeRequest(`/setup_intents/${encodeURIComponent(current.stripe_setup_intent_reference)}`, {
      method: "GET", stripe, options,
    });
  } else {
    intent = await stripeRequest("/setup_intents", {
      method: "POST", stripe, options,
      idempotencyKey: `trg-customer-setup-${attemptId}`,
      params: {
        customer: customerId,
        usage: "on_session",
        "payment_method_types[0]": "card",
        "metadata[trg_user_id]": user.id,
        "metadata[trg_attempt_id]": attemptId,
      },
    });
    if (!/^seti_[A-Za-z0-9]+$/.test(intent.id || "") || intent.customer !== customerId || !intent.client_secret || intent.livemode !== stripe.livemode) {
      throw new PaymentMethodError("Stripe did not return a valid card-setup session.", 503);
    }
    await db.prepare(`UPDATE customer_payment_setup_attempts SET stripe_setup_intent_reference=?,
      state='requires_confirmation',updated_at=? WHERE id=? AND user_id=?`)
      .bind(intent.id, new Date(options.nowMs || Date.now()).toISOString(), attemptId, user.id).run();
  }
  if (intent.customer !== customerId || intent.livemode !== stripe.livemode || !intent.client_secret) {
    throw new PaymentMethodError("The saved-card setup session could not be confirmed.", 503);
  }
  return { ok: true, attemptId, clientSecret: intent.client_secret, publishableKey: stripe.publishableKey };
}

async function createStripeCustomer(db, user, profile, stripe, options) {
  const name = [profile.billing_first_name, profile.billing_last_name].filter(Boolean).join(" ");
  const customer = await stripeRequest("/customers", {
    method: "POST", stripe, options,
    idempotencyKey: `trg-customer-${user.id}`,
    params: { email: user.email_normalized, name, "metadata[trg_user_id]": user.id },
  });
  if (!/^cus_[A-Za-z0-9]+$/.test(customer.id || "") || customer.livemode !== stripe.livemode) {
    throw new PaymentMethodError("Stripe did not return a valid customer reference.", 503);
  }
  await db.prepare(`UPDATE user_account_profiles SET stripe_customer_reference=?,updated_at=? WHERE user_id=?`)
    .bind(customer.id, new Date(options.nowMs || Date.now()).toISOString(), user.id).run();
  return customer.id;
}

async function confirmSetup(db, user, env, body, options) {
  const attemptId = safeAttemptId(body.attemptId);
  const intentId = String(body.setupIntentId || "");
  if (!/^seti_[A-Za-z0-9]+$/.test(intentId)) throw new PaymentMethodError("The card setup reference is invalid.", 400);
  const attempt = await db.prepare(`SELECT * FROM customer_payment_setup_attempts WHERE id=? AND user_id=?`)
    .bind(attemptId, user.id).first();
  if (!attempt || attempt.stripe_setup_intent_reference !== intentId) throw new PaymentMethodError("This card setup does not belong to your account.", 403);
  const stripe = stripeSettings(env);
  const intent = await stripeRequest(`/setup_intents/${encodeURIComponent(intentId)}?expand[]=payment_method`, { method: "GET", stripe, options });
  const customer = String(typeof intent.customer === "object" ? intent.customer?.id : intent.customer || "");
  if (intent.id !== intentId || intent.status !== "succeeded" || intent.livemode !== stripe.livemode ||
      customer !== String((await db.prepare("SELECT stripe_customer_reference FROM user_account_profiles WHERE user_id=?").bind(user.id).first())?.stripe_customer_reference || "") ||
      intent.metadata?.trg_user_id !== user.id || intent.metadata?.trg_attempt_id !== attemptId) {
    throw new PaymentMethodError("Stripe has not confirmed this card for your account.", 409);
  }
  let method = intent.payment_method;
  if (typeof method === "string") method = await stripeRequest(`/payment_methods/${encodeURIComponent(method)}`, { method: "GET", stripe, options });
  const card = method?.card;
  const attachedCustomer = String(typeof method?.customer === "object" ? method.customer?.id : method?.customer || "");
  if (!/^pm_[A-Za-z0-9]+$/.test(method?.id || "") || attachedCustomer !== customer || method.type !== "card" ||
      !card || !/^\d{4}$/.test(String(card.last4 || "")) || !Number.isInteger(Number(card.exp_month)) ||
      !Number.isInteger(Number(card.exp_year)) || Number(card.exp_month) < 1 || Number(card.exp_month) > 12) {
    throw new PaymentMethodError("Stripe's confirmed card details were incomplete.", 503);
  }
  const now = new Date(options.nowMs || Date.now()).toISOString();
  const existingDefault = await db.prepare("SELECT default_payment_method_reference FROM user_account_profiles WHERE user_id=?").bind(user.id).first();
  const isDefault = !existingDefault?.default_payment_method_reference;
  await db.batch([
    db.prepare(`INSERT INTO customer_saved_payment_methods(payment_method_reference,user_id,stripe_customer_reference,
      cardholder_name,card_brand,card_last4,expiration_month,expiration_year,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'active',?,?) ON CONFLICT(payment_method_reference) DO UPDATE SET
      cardholder_name=excluded.cardholder_name,card_brand=excluded.card_brand,card_last4=excluded.card_last4,
      expiration_month=excluded.expiration_month,expiration_year=excluded.expiration_year,state='active',updated_at=excluded.updated_at
      WHERE customer_saved_payment_methods.user_id=excluded.user_id`)
      .bind(method.id, user.id, customer, clean(method.billing_details?.name, 160), clean(card.brand, 30), String(card.last4),
        Number(card.exp_month), Number(card.exp_year), now, now),
    db.prepare(`UPDATE user_account_profiles SET
      default_payment_method_reference=CASE WHEN ? THEN ? ELSE default_payment_method_reference END,
      payment_card_brand=CASE WHEN ? THEN ? ELSE payment_card_brand END,
      payment_card_last4=CASE WHEN ? THEN ? ELSE payment_card_last4 END,
      payment_method_status='ready',payment_method_status_updated_at=?,updated_at=? WHERE user_id=?`)
      .bind(Number(isDefault), method.id, Number(isDefault), clean(card.brand, 30), Number(isDefault), String(card.last4), now, now, user.id),
    db.prepare("UPDATE customer_payment_setup_attempts SET state='succeeded',updated_at=? WHERE id=? AND user_id=?")
      .bind(now, attemptId, user.id),
  ]);
  const activated = await activatePendingCustomer(db, user.id, now);
  return { ok: true, activated, ...await listPaymentMethods(db, user.id) };
}

async function setDefault(db, userId, paymentMethodId, options) {
  const method = await ownedActiveMethod(db, userId, paymentMethodId);
  const now = new Date(options.nowMs || Date.now()).toISOString();
  await db.batch([
    db.prepare("UPDATE customer_saved_payment_methods SET updated_at=? WHERE payment_method_reference=? AND user_id=?")
      .bind(now, method.payment_method_reference, userId),
    db.prepare(`UPDATE user_account_profiles SET default_payment_method_reference=?,payment_card_brand=?,
      payment_card_last4=?,payment_method_status='ready',payment_method_status_updated_at=?,updated_at=? WHERE user_id=?`)
      .bind(method.payment_method_reference, method.card_brand, method.card_last4, now, now, userId),
  ]);
  return { ok: true, ...await listPaymentMethods(db, userId) };
}

async function removePaymentMethod(db, userId, env, paymentMethodId, options) {
  const method = await ownedActiveMethod(db, userId, paymentMethodId);
  const stripe = stripeSettings(env);
  await stripeRequest(`/payment_methods/${encodeURIComponent(method.payment_method_reference)}/detach`, {
    method: "POST", stripe, options, idempotencyKey: `trg-detach-${method.payment_method_reference}`,
  });
  const now = new Date(options.nowMs || Date.now()).toISOString();
  const next = await db.prepare(`SELECT * FROM customer_saved_payment_methods WHERE user_id=? AND state='active'
    AND payment_method_reference<>? ORDER BY created_at LIMIT 1`).bind(userId, method.payment_method_reference).first();
  await db.batch([
    db.prepare("UPDATE customer_saved_payment_methods SET state='removed',updated_at=? WHERE payment_method_reference=? AND user_id=?")
      .bind(now, method.payment_method_reference, userId),
    db.prepare(`UPDATE user_account_profiles SET default_payment_method_reference=?,payment_card_brand=?,payment_card_last4=?,
      payment_method_status=?,payment_method_status_updated_at=?,updated_at=? WHERE user_id=?`)
      .bind(next?.payment_method_reference || "", next?.card_brand || "", next?.card_last4 || "", next ? "ready" : "missing", now, now, userId),
  ]);
  return { ok: true, ...await listPaymentMethods(db, userId) };
}

async function ownedActiveMethod(db, userId, paymentMethodId) {
  const id = String(paymentMethodId || "");
  if (!/^pm_[A-Za-z0-9]+$/.test(id)) throw new PaymentMethodError("Choose a valid saved card.", 400);
  const method = await db.prepare(`SELECT * FROM customer_saved_payment_methods WHERE payment_method_reference=?
    AND user_id=? AND state='active'`).bind(id, userId).first();
  if (!method) throw new PaymentMethodError("That saved card is not available to this account.", 404);
  return method;
}

async function listPaymentMethods(db, userId) {
  const profile = await db.prepare("SELECT payment_method_status,default_payment_method_reference FROM user_account_profiles WHERE user_id=?").bind(userId).first();
  const result = await db.prepare(`SELECT payment_method_reference AS id,cardholder_name AS cardholderName,
    card_brand AS brand,card_last4 AS last4,expiration_month AS expirationMonth,
    expiration_year AS expirationYear,state,created_at AS createdAt
    FROM customer_saved_payment_methods WHERE user_id=? AND state='active' ORDER BY created_at`).bind(userId).all();
  return { paymentMethodStatus: profile?.payment_method_status || "missing", defaultId: profile?.default_payment_method_reference || "", paymentMethods: result.results || [] };
}

async function hydrateLegacyPaymentMethodDetails(db, userId, env, options) {
  const missing = await db.prepare(`SELECT m.payment_method_reference,m.stripe_customer_reference FROM customer_saved_payment_methods m
    WHERE m.user_id=? AND m.state='active' AND (m.expiration_month IS NULL OR m.expiration_year IS NULL)`)
    .bind(userId).all();
  if (!(missing.results || []).length) return;
  let stripe;
  try { stripe = stripeSettings(env); } catch { return; }
  for (const method of missing.results || []) {
    try {
      const providerMethod = await stripeRequest(`/payment_methods/${encodeURIComponent(method.payment_method_reference)}`, { method: "GET", stripe, options });
      const attachedCustomer = String(typeof providerMethod.customer === "object" ? providerMethod.customer?.id : providerMethod.customer || "");
      const card = providerMethod.card;
      if (providerMethod.id !== method.payment_method_reference || attachedCustomer !== method.stripe_customer_reference ||
          providerMethod.type !== "card" || !card || !Number.isInteger(Number(card.exp_month)) ||
          !Number.isInteger(Number(card.exp_year)) || !/^\d{4}$/.test(String(card.last4 || ""))) continue;
      await db.prepare(`UPDATE customer_saved_payment_methods SET cardholder_name=?,card_brand=?,card_last4=?,
        expiration_month=?,expiration_year=?,updated_at=? WHERE payment_method_reference=? AND user_id=? AND state='active'`)
        .bind(clean(providerMethod.billing_details?.name, 160), clean(card.brand, 30), String(card.last4), Number(card.exp_month),
          Number(card.exp_year), new Date(options.nowMs || Date.now()).toISOString(), method.payment_method_reference, userId).run();
    } catch {
      // Keep the historical reference visible; Owner and customer access do not depend on hydration.
    }
  }
}

function stripeSettings(env) {
  const stage = String(env.PAYMENT_PIPELINE_STAGE || "").trim().toLowerCase();
  const configuration = validateStripeKey(env.STRIPE_SECRET_KEY, stage);
  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY || "").trim();
  const prefix = configuration.livemode ? "pk_live_" : "pk_test_";
  if (!publishableKey.startsWith(prefix)) throw new PaymentMethodError("Stripe card setup is not configured for this environment.", 503);
  return { ...configuration, publishableKey };
}

async function stripeRequest(path, { method = "GET", stripe, options = {}, params, idempotencyKey } = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`${String(options.apiBase || STRIPE_API).replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${stripe.secretKey}`,
        "stripe-version": STRIPE_API_VERSION,
        ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(params ? { body: new URLSearchParams(params).toString() } : {}),
    });
  } catch {
    throw new PaymentMethodError("Stripe card setup is temporarily unavailable. Retry from your account page.", 503);
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload || payload.error) {
    const status = Number(response.status || 0) >= 500 || [408, 409, 425, 429].includes(Number(response.status)) ? 503 : 400;
    throw new PaymentMethodError("Stripe could not complete the saved-card request. Check the details and try again.", status);
  }
  return payload;
}

function safeAttemptId(value) {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new PaymentMethodError("Refresh the page and retry the card setup.", 400);
  }
  return id;
}
function clean(value, max) { return String(value || "").trim().slice(0, max); }
function publicError(error) { return error instanceof PaymentMethodError ? error.message : "Saved-card management is temporarily unavailable."; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "cache-control": "private, no-store", "content-type": "application/json" } }); }
class PaymentMethodError extends Error { constructor(message, httpStatus) { super(message); this.httpStatus = httpStatus; } }
