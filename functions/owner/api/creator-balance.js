import { verifyAuthenticatedOwnerMutationRequest } from "../../_lib/owner-mutation-auth.mjs";
import {
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  jsonResponse,
  readCookie,
  verifySessionToken,
} from "../../_lib/owner-auth.mjs";
import { refundCreatorBalancePurchase } from "../../_lib/creator-balance.mjs";
import { correctCreatorServicePurchase } from "../../_lib/creator-service-refunds.mjs";
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
    "SELECT p.id,p.creator_id,c.display_name creator_name,o.owner_user_id,o.identity_type,o.billing_cadence,o.billing_status,p.service_type,p.service_sku,p.quantity,p.amount_cents,p.currency,p.payment_source,p.settlement_method,p.processor_fee_cents,p.processor_fee_authoritative,p.balance_transaction_id,p.stripe_checkout_session_id,p.provider_event_id,p.provider_payment_reference,p.status,p.created_at,p.completed_at,p.reversed_at,(SELECT cp.coverage_starts_at FROM creator_identity_coverage_periods cp WHERE cp.service_purchase_id=p.id) coverage_starts_at,(SELECT cp.coverage_ends_at FROM creator_identity_coverage_periods cp WHERE cp.service_purchase_id=p.id) coverage_ends_at,COALESCE((SELECT SUM(r.amount_cents) FROM marketplace_service_revenue_ledger r WHERE r.service_purchase_id=p.id),0) recognized_service_revenue_cents FROM marketplace_service_purchases p JOIN marketplace_creators c ON c.id=p.creator_id LEFT JOIN creator_identity_ownership o ON o.creator_id=p.creator_id ORDER BY p.created_at DESC LIMIT 250",
  ).all();
  const identities = await env.TRG_ORDERS.prepare(
    "SELECT o.creator_id,c.display_name creator_name,o.owner_user_id,o.identity_type,o.account_status,o.billing_cadence,o.billing_status,o.entitlement_source,(SELECT cp.billing_plan FROM creator_identity_coverage_periods cp JOIN marketplace_service_purchases p ON p.id=cp.service_purchase_id WHERE cp.creator_id=o.creator_id AND cp.status='active' AND p.status='settled' ORDER BY cp.coverage_ends_at DESC LIMIT 1) current_plan,(SELECT cp.coverage_starts_at FROM creator_identity_coverage_periods cp JOIN marketplace_service_purchases p ON p.id=cp.service_purchase_id WHERE cp.creator_id=o.creator_id AND cp.status='active' AND p.status='settled' ORDER BY cp.coverage_ends_at DESC LIMIT 1) latest_coverage_starts_at,(SELECT cp.coverage_ends_at FROM creator_identity_coverage_periods cp JOIN marketplace_service_purchases p ON p.id=cp.service_purchase_id WHERE cp.creator_id=o.creator_id AND cp.status='active' AND p.status='settled' ORDER BY cp.coverage_ends_at DESC LIMIT 1) paid_through_at,CASE WHEN o.account_status<>'active' THEN 'inactive' WHEN o.identity_type='primary' THEN 'included' WHEN o.billing_status='legacy_grandfathered' THEN 'legacy_grandfathered' WHEN EXISTS(SELECT 1 FROM creator_identity_coverage_periods cp JOIN marketplace_service_purchases p ON p.id=cp.service_purchase_id WHERE cp.creator_id=o.creator_id AND cp.status='active' AND p.status='settled' AND cp.coverage_ends_at>datetime('now')) THEN 'current' WHEN EXISTS(SELECT 1 FROM creator_identity_coverage_periods cp WHERE cp.creator_id=o.creator_id) THEN 'expired' ELSE 'billing_required' END entitlement_status FROM creator_identity_ownership o JOIN marketplace_creators c ON c.id=o.creator_id ORDER BY o.owner_user_id,o.identity_type DESC,c.created_at",
  ).all();
  const preferredCommitments = await env.TRG_ORDERS.prepare(
    "SELECT b.*,c.display_name creator_name,(SELECT COUNT(*) FROM preferred_billing_installments i WHERE i.commitment_id=b.id AND i.status='paid') installments_paid,(SELECT COUNT(*) FROM preferred_billing_installments i WHERE i.commitment_id=b.id AND i.status<>'paid' AND i.status<>'cancelled') installments_outstanding FROM preferred_billing_commitments b JOIN marketplace_creators c ON c.id=b.creator_id ORDER BY b.commitment_starts_at DESC",
  ).all();
  const preferredInstallments = await env.TRG_ORDERS.prepare(
    "SELECT i.*,b.creator_id,b.owner_user_id,p.payment_source,p.provider_event_id,p.provider_payment_reference,p.processor_fee_cents,p.processor_fee_authoritative FROM preferred_billing_installments i JOIN preferred_billing_commitments b ON b.id=i.commitment_id LEFT JOIN marketplace_service_purchases p ON p.id=i.service_purchase_id ORDER BY i.due_at DESC LIMIT 300",
  ).all();
  const preferredProviderAttempts = await env.TRG_ORDERS.prepare(
    "SELECT a.*,i.commitment_id,i.installment_number,b.creator_id FROM preferred_billing_provider_attempts a JOIN preferred_billing_installments i ON i.id=a.installment_id JOIN preferred_billing_commitments b ON b.id=i.commitment_id ORDER BY a.created_at DESC LIMIT 300",
  ).all();
  const serviceCorrections = await env.TRG_ORDERS.prepare(
    "SELECT r.*,p.service_type,p.service_sku,p.amount_cents original_amount_cents,p.provider_payment_reference FROM creator_service_refund_corrections r JOIN marketplace_service_purchases p ON p.id=r.service_purchase_id ORDER BY r.created_at DESC LIMIT 300",
  ).all();
  const correctionRows = serviceCorrections.results || [];
  const servicePurchases = (services.results || []).map((purchase) => {
      const corrections = correctionRows.filter(
        (correction) => correction.service_purchase_id === purchase.id,
      );
      return {
        ...purchase,
        correction_count: corrections.length,
        corrected_amount_cents: corrections
          .filter((correction) =>
            ["processing", "provider_pending", "completed"].includes(
              correction.status,
            ),
          )
          .reduce((sum, correction) => sum + Number(correction.amount_cents), 0),
        latest_correction: corrections[0] || null,
      };
    }),
    settled = servicePurchases.filter((item) => item.status === "settled"),
    serviceRevenue = {
      grossCents: settled.reduce(
        (sum, item) => sum + Number(item.recognized_service_revenue_cents),
        0,
      ),
      stripeGrossCents: settled
        .filter((item) => item.payment_source === "stripe")
        .reduce(
          (sum, item) => sum + Number(item.recognized_service_revenue_cents),
          0,
        ),
      creatorBalanceGrossCents: settled
        .filter((item) => item.payment_source === "creator_balance")
        .reduce(
          (sum, item) => sum + Number(item.recognized_service_revenue_cents),
          0,
        ),
      additionalIdentityMonthlyCents: settled
        .filter((item) => item.service_sku === "additional_identity_monthly")
        .reduce(
          (sum, item) => sum + Number(item.recognized_service_revenue_cents),
          0,
        ),
      additionalIdentityAnnualCents: settled
        .filter((item) => item.service_sku === "additional_identity_annual")
        .reduce(
          (sum, item) => sum + Number(item.recognized_service_revenue_cents),
          0,
        ),
      preferredMonthlyInstallmentCents: settled
        .filter((item) => item.service_sku === "preferred_monthly")
        .reduce((sum, item) => sum + Number(item.recognized_service_revenue_cents), 0),
      preferredAnnualPrepaidCents: settled
        .filter((item) => item.service_sku === "preferred_annual")
        .reduce((sum, item) => sum + Number(item.recognized_service_revenue_cents), 0),
      authoritativeProcessorFeesCents: settled
        .filter((item) => Number(item.processor_fee_authoritative) === 1)
        .reduce((sum, item) => sum + Number(item.processor_fee_cents), 0),
      unknownProcessorFeeCount: settled.filter(
        (item) => Number(item.processor_fee_authoritative) !== 1,
      ).length,
    };
  return jsonResponse({
    settlements: result.results || [],
    identityEntitlements: identities.results || [],
    preferredCommitments: preferredCommitments.results || [],
    preferredInstallments: preferredInstallments.results || [],
    preferredProviderAttempts: preferredProviderAttempts.results || [],
    serviceCorrections: correctionRows,
    servicePurchases,
    serviceRevenue,
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
  if (body.action === "correct_service_purchase") {
    try {
      return jsonResponse({
        ok: true,
        ...(await correctCreatorServicePurchase(env.TRG_ORDERS, {
          servicePurchaseId: String(body.servicePurchaseId || ""),
          operatorId: auth.username,
          reasonCategory: String(body.reasonCategory || ""),
          reasonDetail: String(body.reasonDetail || ""),
          refundAmountCents: body.refundAmountCents,
          entitlementAction: String(body.entitlementAction || "none"),
          entitlementAdjustment: body.entitlementAdjustment || {},
          idempotencyKey: String(body.idempotencyKey || ""),
          env,
        })),
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, 409);
    }
  }
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
