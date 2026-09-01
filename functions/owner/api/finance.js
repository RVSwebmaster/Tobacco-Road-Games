import {
  SESSION_COOKIE_NAME,
  getOwnerSecrets,
  jsonResponse,
  readCookie,
  verifySessionToken,
} from "../../_lib/owner-auth.mjs";
import {
  getMarketplaceCreatorLiability,
  getPayoutCompletionCapacity,
  getTrgRevenueReport,
  listFinanceTransactions,
} from "../../_lib/creator-liability.mjs";
import {
  getCreatorPayoutStatus,
  reconcileProviderFinance,
} from "../../_lib/creator-payout-readiness.mjs";
import { reconcileCreatorFinance } from "../../_lib/creator-finance.mjs";

export async function onRequestGet({ request, env }) {
  const auth = await verifySessionToken(
    readCookie(request, SESSION_COOKIE_NAME),
    getOwnerSecrets(env).sessionSecret,
    Date.now(),
  );
  if (!auth.valid)
    return jsonResponse({ error: "Operator access required." }, 403);
  const url = new URL(request.url),
    creatorId = url.searchParams.get("creator"),
    reference = url.searchParams.get("reference");
  const [
    liability,
    revenue,
    transactions,
    ledgerExceptions,
    providerExceptions,
  ] = await Promise.all([
    getMarketplaceCreatorLiability(env.TRG_ORDERS),
    getTrgRevenueReport(env.TRG_ORDERS),
    listFinanceTransactions(env.TRG_ORDERS),
    reconcileCreatorFinance(env.TRG_ORDERS),
    reconcileProviderFinance(env.TRG_ORDERS),
  ]);
  for (const item of liability.items) {
    const status = await getCreatorPayoutStatus(env.TRG_ORDERS, item.id, {
      env,
    });
    item.payoutReady = status.eligible;
    item.payoutBlockedReasons = status.blockedReasons;
    const reservation = await env.TRG_ORDERS.prepare(
      "SELECT r.payout_request_id FROM creator_payout_reservations r JOIN creator_payout_requests q ON q.id=r.payout_request_id WHERE r.creator_id=? AND r.status='reserved' AND q.status IN ('pending','processing') LIMIT 1",
    )
      .bind(item.id)
      .first();
    if (reservation) {
      const completion = await getPayoutCompletionCapacity(env.TRG_ORDERS, {
        payoutRequestId: reservation.payout_request_id,
        creatorId: item.id,
      });
      item.reservedPayoutCompletionState = completion.completionSafe
        ? "completable"
        : "blocked";
      item.reservedPayoutCompletionCapacityCents =
        completion.rawCompletionCapacityCents;
    }
  }
  const filters = {
    creatorId: String(creatorId || ""),
    reference: String(reference || ""),
  };
  if (filters.creatorId) {
    transactions.product = transactions.product.filter(
      (x) => x.creator_id === filters.creatorId,
    );
    transactions.service = transactions.service.filter(
      (x) => x.creator_id === filters.creatorId,
    );
    transactions.audit = transactions.audit.filter(
      (x) => x.creator_id === filters.creatorId,
    );
  }
  if (filters.reference)
    transactions.product = transactions.product.filter(
      (x) => x.order_reference === filters.reference,
    );
  const exceptions = [
    ...ledgerExceptions.map((x) => ({ ...x, source: "ledger" })),
    ...providerExceptions.map((x) => ({ ...x, source: "provider" })),
  ];
  if (revenue.costs.unknownServiceProcessorFeeCount)
    exceptions.push({
      source: "service",
      code: "unknown_processor_fee",
      count: revenue.costs.unknownServiceProcessorFeeCount,
    });
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    liability,
    revenue,
    transactions,
    exceptions,
    filters,
    bankReconciliation: {
      creatorMoneyRequiredCents: liability.totals.totalCreatorLiabilityCents,
      trgEarnedLedgerAmountCents: revenue.netRetainedRevenueCents,
      warning: revenue.timingWarning,
    },
  });
}
