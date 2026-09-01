(() => {
  const money = (n) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(n || 0) / 100),
    td = (v) => {
      const x = document.createElement("td");
      x.textContent = v ?? "—";
      return x;
    },
    tr = (values) => {
      const x = document.createElement("tr");
      x.append(...values.map(td));
      return x;
    };
  function card(label, value, note = "") {
    const x = document.createElement("article");
    x.className = "finance-card";
    const l = document.createElement("span"),
      v = document.createElement("strong"),
      p = document.createElement("small");
    l.textContent = label;
    v.textContent = money(value);
    p.textContent = note;
    x.append(l, v, p);
    return x;
  }
  async function load() {
    const r = await fetch(`/owner/api/finance${location.search}`, {
        credentials: "same-origin",
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.error || "Finance report unavailable.");
    const t = d.liability.totals,
      u = d.revenue;
    document
      .querySelector("#summary")
      .replaceChildren(
        card(
          "Total Creator Liability",
          t.totalCreatorLiabilityCents,
          "Positive obligations; no cross-Creator negative netting",
        ),
        card("Available to Creators", t.availableBalanceCents),
        card("Pending", t.pendingBalanceCents),
        card("Held", t.heldBalanceCents),
        card("Payout Reserved", t.payoutReservedCents),
        card("Purchase Reserved", t.purchaseReservedCents),
        card("Negative Balances", t.negativeBalanceCents, "Shown separately"),
        card("TRG Product Commission", u.productCommission.netCents),
        card("TRG Service Revenue", u.serviceRevenue.netCents),
        card("Processor / Provider Costs", u.costs.totalCents),
        card("TRG Net Retained", u.netRetainedRevenueCents),
        card(
          "External Stripe Activity",
          u.cashActivity.externalStripeProductCents +
            u.cashActivity.externalStripeServiceCents,
        ),
        card(
          "Internal Balance Activity",
          u.cashActivity.internalCreatorBalanceProductCents +
            u.cashActivity.internalCreatorBalanceServiceCents,
        ),
      );
    document.querySelector("#bank").textContent =
      `Creator Money Required: ${money(d.bankReconciliation.creatorMoneyRequiredCents)}. TRG-earned ledger amount: ${money(d.bankReconciliation.trgEarnedLedgerAmountCents)}. ${d.bankReconciliation.warning}`;
    document
      .querySelector("#creators")
      .replaceChildren(
        ...d.liability.items.map((x) =>
          tr([
            x.display_name,
            money(x.currentNetLiabilityCents),
            money(x.availableBalanceCents),
            money(x.pendingBalanceCents),
            money(x.heldBalanceCents),
            money(x.disputeHeldCents),
            money(x.payoutReservedCents),
            money(x.purchaseReservedCents),
            money(x.negativeBalanceCents),
            money(x.payoutEligibleCents),
            x.payoutReady ? "Ready" : x.payoutBlockedReasons.join(" "),
          ]),
        ),
      );
    document
      .querySelector("#revenue")
      .replaceChildren(
        tr([
          "Product commission",
          money(u.productCommission.stripeGrossCents),
          money(u.productCommission.creatorBalanceNetCents),
          money(u.productCommission.reversalsCents),
          money(u.productCommission.netCents),
        ]),
        tr([
          "Preferred",
          money(u.serviceRevenue.preferredStripeNetCents),
          money(u.serviceRevenue.preferredCreatorBalanceNetCents),
          "Included in net",
          money(
            u.serviceRevenue.preferredStripeNetCents +
              u.serviceRevenue.preferredCreatorBalanceNetCents,
          ),
        ]),
        tr([
          "Ad Credits",
          money(u.serviceRevenue.adCreditsStripeNetCents),
          money(u.serviceRevenue.adCreditsCreatorBalanceNetCents),
          "Included in net",
          money(
            u.serviceRevenue.adCreditsStripeNetCents +
              u.serviceRevenue.adCreditsCreatorBalanceNetCents,
          ),
        ]),
        tr([
          "Additional identities",
          money(u.serviceRevenue.additionalIdentityStripeNetCents),
          money(u.serviceRevenue.additionalIdentityCreatorBalanceNetCents),
          "Included in net",
          money(
            u.serviceRevenue.additionalIdentityStripeNetCents +
              u.serviceRevenue.additionalIdentityCreatorBalanceNetCents,
          ),
        ]),
        tr([
          "All service revenue",
          money(u.serviceRevenue.stripeNetCents),
          money(u.serviceRevenue.creatorBalanceNetCents),
          money(u.serviceRevenue.reversalsCents),
          money(u.serviceRevenue.netCents),
        ]),
        tr([
          "Processor/provider costs",
          money(u.costs.productProcessorFeesCents),
          money(u.costs.serviceProcessorFeesCents),
          money(u.costs.marketplaceProviderCostsCents),
          money(u.costs.totalCents),
        ]),
      );
    document.querySelector("#exceptions").replaceChildren(
      ...(d.exceptions.length
        ? d.exceptions
        : [{ source: "reconciliation", code: "none" }]
      ).map((x) => {
        const p = document.createElement("p");
        p.textContent =
          x.code === "none"
            ? "No reconciliation exceptions detected."
            : `${x.source}: ${x.code}${x.count ? ` (${x.count})` : ""}`;
        return p;
      }),
    );
    document
      .querySelector("#products")
      .replaceChildren(
        ...d.transactions.product.map((x) =>
          tr([
            x.order_reference,
            new Date(x.created_at).toLocaleString(),
            `${x.creator_name} · ${x.product_title}`,
            x.payment_source,
            money(x.gross_cents),
            money(x.creator_net_cents),
            money(x.marketplace_fee_cents),
            money(x.processor_fee_cents),
            x.payout_state,
            x.entitlement_status,
            x.reversal_count,
          ]),
        ),
      );
    document
      .querySelector("#services")
      .replaceChildren(
        ...d.transactions.service.map((x) =>
          tr([
            x.id,
            new Date(x.created_at).toLocaleString(),
            `${x.creator_name} · ${x.service_sku}`,
            x.payment_source,
            money(x.amount_cents),
            money(x.recognized_revenue_cents),
            `${money(x.processor_fee_cents)}${x.processor_fee_authoritative ? "" : " (unconfirmed)"}`,
            x.identity_coverage_ends_at ||
              x.preferred_coverage_ends_at ||
              "credits/slot ledger",
            x.correction_count,
            x.status,
          ]),
        ),
      );
    document
      .querySelector("#audit")
      .replaceChildren(
        ...d.transactions.audit.map((x) =>
          tr([
            new Date(x.created_at).toLocaleString(),
            x.action,
            `${x.actor_type}: ${x.actor_id}`,
            x.creator_id || "marketplace",
            x.amount_cents == null ? "—" : money(x.amount_cents),
            x.context_json,
          ]),
        ),
      );
    document.querySelector("#status").textContent =
      `Report generated ${new Date(d.generatedAt).toLocaleString()}.`;
  }
  load().catch(
    (e) => (document.querySelector("#status").textContent = e.message),
  );
})();
