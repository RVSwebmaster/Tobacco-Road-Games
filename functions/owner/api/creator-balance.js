import { verifyAuthenticatedOwnerMutationRequest } from "../../_lib/owner-mutation-auth.mjs";
import {
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  jsonResponse,
  readCookie,
  verifySessionToken,
} from "../../_lib/owner-auth.mjs";
import { refundCreatorBalancePurchase } from "../../_lib/creator-balance.mjs";
export async function onRequestGet({ request, env }) {
  const auth = await verifySessionToken(
    readCookie(request, SESSION_COOKIE_NAME),
    getOwnerSecrets(env).sessionSecret,
    Date.now(),
  );
  if (!auth.valid)
    return jsonResponse({ error: "Operator access required." }, 403);
  const result = await env.TRG_ORDERS.prepare(
    "SELECT s.order_public_id,s.gross_cents,s.marketplace_commission_cents,s.seller_net_cents,s.currency,s.status,s.settled_at,s.refunded_at,c.display_name buyer_creator FROM creator_balance_settlements s JOIN marketplace_creators c ON c.id=s.buyer_creator_id ORDER BY s.settled_at DESC LIMIT 250",
  ).all();
  const services = await env.TRG_ORDERS.prepare(
    "SELECT p.id,p.creator_id,c.display_name creator_name,p.service_type,p.service_sku,p.quantity,p.amount_cents,p.currency,p.payment_source,p.settlement_method,p.processor_fee_cents,p.balance_transaction_id,p.status,p.created_at,p.reversed_at FROM marketplace_service_purchases p JOIN marketplace_creators c ON c.id=p.creator_id ORDER BY p.created_at DESC LIMIT 250",
  ).all();
  return jsonResponse({
    settlements: result.results || [],
    servicePurchases: services.results || [],
  });
}
export async function onRequestPost({ request, env }) {
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env);
  if (!auth.valid)
    return jsonResponse({ error: auth.userMessage }, auth.status);
  let body = {};
  try {
    body = await request.json();
  } catch {}
  if (body.action !== "refund" || !body.orderPublicId)
    return jsonResponse(
      {
        error:
          "A Creator Balance refund action and order reference are required.",
      },
      400,
    );
  try {
    return jsonResponse({
      ok: true,
      ...(await refundCreatorBalancePurchase(env.TRG_ORDERS, {
        orderPublicId: String(body.orderPublicId),
        actorId: auth.username,
      })),
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 409);
  }
}
