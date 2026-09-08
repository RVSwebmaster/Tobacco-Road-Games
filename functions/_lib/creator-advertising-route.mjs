import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
import {
  activateIncluded,
  deactivateSlot,
  getAdvertising,
  reassignSlot,
  redeemCredit,
  startCreditPurchase,
  uploadCreative,
} from "./creator-advertising.mjs";
import { purchaseServiceWithCreatorBalance } from "./creator-service-purchases.mjs";
import { getCreatorBalance } from "./creator-balance.mjs";
import { getCreatorOperationalEligibility } from "./creator-registration.mjs";
import { getCreatorInternalPurchasePrivilege } from "./creator-internal-purchase-policy.mjs";
import { resolveCreatorMembershipIdentity } from "./creator-identity-selection.mjs";
export async function handleCreatorAdvertisingRequest(
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
      { error: { message: "Sign in to access advertising tools." } },
      401,
    );
  const requestedCreator = new URL(request.url).searchParams.get("creator"),
    selection = await resolveCreatorMembershipIdentity(db, {
      userId: session.user.id,
      requestedCreator,
    }),
    creator = selection.creator;
  if (!creator)
    return json(
      {
        error: {
          message: selection.ambiguous
            ? "Choose the Creator identity you want to operate."
            : "Creator access is unavailable.",
        },
      },
      selection.ambiguous ? 409 : 403,
    );
  if (creator.marketplace_status !== "approved")
    return json({ error: { message: "Creator access is unavailable." } }, 403);
  const contact = await db
    .prepare("SELECT email_normalized FROM users WHERE id=?")
    .bind(session.user.id)
    .first();
  creator.contact_email = contact?.email_normalized || "";
  const readiness = await getCreatorOperationalEligibility(db, creator.id, {
    markInitialCompletion: true,
    nowMs: options.nowMs,
  });
  if (request.method !== "GET" && !readiness.eligible)
    return json(
      {
        error: {
          message:
            "Current Creator eligibility requirements must be restored before advertising changes or purchases are available.",
          reasons: readiness.reasonCodes,
          remediation: readiness.remediation,
        },
      },
      403,
    );
  if (request.method === "GET") {
    const privilege = await getCreatorInternalPurchasePrivilege(db, {
      creatorId: creator.id,
      userId: session.user.id,
      nowMs: options.nowMs,
    });
    return json({
      ...(await getAdvertising(db, creator.id, { nowMs: options.nowMs })),
      creatorBalance: await getCreatorBalance(db, {
        creatorId: creator.id,
        userId: session.user.id,
        nowMs: options.nowMs,
      }),
      internalPurchase: { canUseBalance: Boolean(privilege.allowed && readiness.eligible) },
    });
  }
  if (
    !validateSameOriginRequest(request) ||
    !(await validateSessionCsrf(request, session)).valid
  )
    return json(
      { error: { message: "The advertising request could not be verified." } },
      403,
    );
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data"))
      return json(
        {
          ok: true,
          ...(await uploadCreative(
            request,
            db,
            env.TRG_PRODUCTS,
            creator,
            session,
            { nowMs: options.nowMs },
          )),
        },
        201,
      );
    const body = await request.json();
    if (body.action === "activate_included")
      return json({
        ok: true,
        ...(await activateIncluded(db, {
          creatorId: creator.id,
          creativeId: body.creativeId,
          slotIndex: body.slotIndex,
          actorId: session.user.id,
          nowMs: options.nowMs,
        })),
      });
    if (body.action === "redeem_credit")
      return json({
        ok: true,
        ...(await redeemCredit(db, {
          creatorId: creator.id,
          creativeId: body.creativeId,
          actorId: session.user.id,
          nowMs: options.nowMs,
        })),
      });
    if (body.action === "reassign")
      return json({
        ok: true,
        ...(await reassignSlot(db, {
          creatorId: creator.id,
          slotId: body.slotId,
          creativeId: body.creativeId,
          actorId: session.user.id,
          nowMs: options.nowMs,
        })),
      });
    if (body.action === "deactivate")
      return json({
        ok: true,
        ...(await deactivateSlot(db, {
          creatorId: creator.id,
          slotId: body.slotId,
          actorId: session.user.id,
          nowMs: options.nowMs,
        })),
      });
    if (body.action === "purchase_credits")
      return json({
        ok: true,
        ...(await startCreditPurchase(db, creator, env, {
          fetchImpl: options.fetchImpl,
          nowMs: options.nowMs,
          userId: session.user.id,
        })),
      });
    if (body.action === "purchase_credits_with_creator_balance") {
      if (body.paymentSource !== "creator_balance")
        throw new Error(
          "Explicit Creator Balance payment selection is required.",
        );
      return json(
        {
          ok: true,
          ...(await purchaseServiceWithCreatorBalance(db, {
            creatorId: creator.id,
            userId: session.user.id,
            sku: "ad_credit_package",
            idempotencyKey: String(body.idempotencyKey || ""),
            nowMs: options.nowMs,
          })),
        },
        201,
      );
    }
    return json({ error: { message: "Advertising action is invalid." } }, 400);
  } catch (error) {
    return json({ error: { message: error.message } }, 409);
  }
}
function json(x, status = 200) {
  return new Response(JSON.stringify(x), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
