import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
import { getCreatorAccountReadiness } from "./creator-registration.mjs";
import {
  getCreatorBalance,
  settleCreatorBalancePurchase,
} from "./creator-balance.mjs";
import {
  parsePendingOrderRequest,
  resolvePendingOrderItems,
} from "./orders-pending.mjs";
import { getRuntimeCatalogMap } from "./runtime-catalog.mjs";
import { normalizeCheckoutAttemptId } from "./checkout-attempt.mjs";
import {
  normalizeConfirmedCustomerEmail,
  createCustomerEmailHash,
} from "./order-privacy.mjs";
import { getDeliveryProduct } from "./product-delivery.mjs";
import { readStoreState, storeClosedResponse } from "./store-state.mjs";
import {
  assertNotFraudBlocked,
  findDuplicateDigitalOwnership,
} from "./transaction-policy.mjs";

export async function handleCreatorBalanceRequest(
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
      { error: "Sign in to use Creator Balance.", code: "not_authenticated" },
      401,
    );
  const creator = await db
    .prepare(
      "SELECT c.* FROM marketplace_creators c JOIN creator_identity_ownership o ON o.creator_id=c.id WHERE o.owner_user_id=? AND o.account_status='active' ORDER BY c.created_at LIMIT 1",
    )
    .bind(session.user.id)
    .first();
  if (!creator)
    return json(
      {
        error: "A registered Creator account is required.",
        code: "creator_required",
      },
      403,
    );
  const ready = await getCreatorAccountReadiness(db, creator.id, {
    markInitialCompletion: false,
    nowMs: options.nowMs,
  });
  if (!ready.registrationComplete)
    return json(
      {
        error: "Complete Creator registration before using Creator Balance.",
        code: "registration_incomplete",
      },
      403,
    );
  if (request.method === "GET")
    return json({
      ok: true,
      balance: await getCreatorBalance(db, {
        creatorId: creator.id,
        userId: session.user.id,
        nowMs: options.nowMs,
      }),
    });
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  if (
    !validateSameOriginRequest(request) ||
    !(await validateSessionCsrf(request, session)).valid
  )
    return json(
      {
        error: "The purchase request could not be verified.",
        code: "request_not_verified",
      },
      403,
    );
  const store = await readStoreState(env, { database: db });
  if (!store.available || store.state !== "OPEN")
    return storeClosedResponse(store.state);
  const parsed = await parsePendingOrderRequest(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  if (parsed.body.paymentSource !== "creator_balance")
    return json(
      { error: "Explicit Creator Balance payment selection is required." },
      400,
    );
  let attempt, email;
  try {
    attempt = normalizeCheckoutAttemptId(parsed.body.checkoutAttemptId);
    email = normalizeConfirmedCustomerEmail(
      parsed.body.email,
      parsed.body.emailConfirmation,
    );
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  if (
    Number(session.user.email_verified) !== 1 ||
    String(session.user.email_normalized).toLowerCase() !== email.normalized
  )
    return json(
      { error: "Use the verified email address on your signed-in account." },
      403,
    );
  const resolution = resolvePendingOrderItems(
    parsed.body.items,
    options.catalogMap || getRuntimeCatalogMap(),
    { now: options.nowMs || Date.now() },
  );
  if (
    resolution.unavailableItems.length ||
    !resolution.items.length ||
    resolution.totalCents <= 0
  )
    return json(
      {
        error:
          "Every cart item must be available for a full Creator Balance purchase.",
        unavailableItems: resolution.unavailableItems,
      },
      400,
    );
  const secret = String(
    options.emailHashSecret || env.ORDER_EMAIL_HASH_SECRET || "",
  );
  if (!secret)
    return json({ error: "Creator Balance checkout is not configured." }, 503);
  const hash = await createCustomerEmailHash(email.normalized, secret);
  try {
    await assertNotFraudBlocked(db, {
      emailHash: hash,
      userId: session.user.id,
    });
    const duplicates = await findDuplicateDigitalOwnership(db, {
      userId: session.user.id,
      emailHash: hash,
      productSlugs: resolution.items.map((x) => x.productSlug),
    });
    if (duplicates.length)
      return json(
        {
          error: "You already own one or more products in this cart.",
          ownedProductSlugs: duplicates,
          recoveryUrl: "/account.html",
        },
        409,
      );
  } catch (e) {
    return json({ error: e.message || "Purchase verification failed." }, 403);
  }
  const mappings = [];
  for (const item of resolution.items) {
    const product = getDeliveryProduct(item.productSlug);
    if (!product)
      return json(
        { error: `${item.productSlug} is not configured for secure delivery.` },
        409,
      );
    const head =
      options.deliveryHeads?.[item.productSlug] ||
      (await env.TRG_PRODUCTS?.head(product.r2ObjectKey));
    if (!head)
      return json(
        { error: `${item.productSlug} is not ready for delivery.` },
        409,
      );
    mappings.push({
      ...product,
      objectSize: Number(head.size || head.objectSize || 0),
    });
  }
  try {
    const result = await settleCreatorBalancePurchase(db, {
      buyerCreatorId: creator.id,
      buyerUserId: session.user.id,
      checkoutAttemptId: attempt,
      orderPublicId: `TRG-CB-${crypto.randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`,
      email: email.entered,
      emailHash: hash,
      currency: resolution.currency,
      items: resolution.itemSnapshots,
      deliveryMappings: mappings,
      nowMs: options.nowMs || Date.now(),
      env,
    });
    return json({ ok: true, ...result, accessUrl: "/account.html" }, 201);
  } catch (e) {
    return json(
      {
        error: e.message || "Creator Balance purchase failed.",
        code: /cover|insufficient/i.test(e.message)
          ? "insufficient_creator_balance"
          : "creator_balance_purchase_failed",
      },
      409,
    );
  }
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
