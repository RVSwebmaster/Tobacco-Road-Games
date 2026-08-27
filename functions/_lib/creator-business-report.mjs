export function resolveReportPeriod({
  period = "month",
  value = "",
  nowMs = Date.now(),
} = {}) {
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime()))
    throw new Error("Report clock is invalid.");
  if (period === "month") {
    const month = value || now.toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new Error("Monthly reports require YYYY-MM.");
    const [year, index] = month.split("-").map(Number);
    return {
      kind: "month",
      label: month,
      from: new Date(Date.UTC(year, index - 1, 1)).toISOString(),
      to: new Date(Date.UTC(year, index, 1)).toISOString(),
    };
  }
  if (period === "ytd") {
    const year = Number(value || now.getUTCFullYear());
    if (!Number.isInteger(year) || year !== now.getUTCFullYear())
      throw new Error("YTD reports use the current calendar year.");
    return {
      kind: "ytd",
      label: `${year}-YTD`,
      from: new Date(Date.UTC(year, 0, 1)).toISOString(),
      // Report ranges are half-open. Advancing one millisecond includes records
      // written at the report clock without admitting later activity.
      to: new Date(nowMs + 1).toISOString(),
    };
  }
  if (period === "year") {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year >= now.getUTCFullYear())
      throw new Error(
        "Completed-year reports require a completed calendar year.",
      );
    return {
      kind: "year",
      label: String(year),
      from: new Date(Date.UTC(year, 0, 1)).toISOString(),
      to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
    };
  }
  throw new Error("Report period must be month, ytd, or year.");
}

export async function getCreatorBusinessReport(database, creatorId, period) {
  const sales = await rows(
    database
      .prepare(
        `SELECT s.*,o.public_id order_reference,l.title listing_title
    FROM creator_sale_snapshots s JOIN orders o ON o.id=s.order_id LEFT JOIN creator_listings l ON l.id=s.product_identity_id
    WHERE s.creator_id=? AND s.sold_at>=? AND s.sold_at<? ORDER BY s.sold_at,s.id`,
      )
      .bind(creatorId, period.from, period.to),
  );
  const reversals = await rows(
    database
      .prepare(
        `SELECT r.*,o.public_id order_reference,s.product_slug,s.product_title,s.policy_reason,s.fee_basis_points
    FROM creator_reversal_snapshots r JOIN orders o ON o.id=r.order_id JOIN creator_sale_snapshots s ON s.order_item_id=r.order_item_id
    WHERE r.creator_id=? AND r.created_at>=? AND r.created_at<? ORDER BY r.created_at,r.id`,
      )
      .bind(creatorId, period.from, period.to),
  );
  const ledger = await rows(
    database
      .prepare(
        `SELECT * FROM creator_earnings_ledger WHERE creator_id=? AND created_at>=? AND created_at<? ORDER BY created_at,id`,
      )
      .bind(creatorId, period.from, period.to),
  );
  const payouts = await rows(
    database
      .prepare(
        `SELECT * FROM creator_payouts WHERE creator_id=? AND paid_at>=? AND paid_at<? ORDER BY paid_at,id`,
      )
      .bind(creatorId, period.from, period.to),
  );
  const exceptions = [];
  for (const sale of sales) {
    const entry = ledger.find(
      (row) =>
        row.entry_type === "sale_earning" &&
        Number(row.order_item_id) === Number(sale.order_item_id),
    );
    if (!entry || Number(entry.amount_cents) !== Number(sale.creator_net_cents))
      exceptions.push({
        code: "sale_snapshot_ledger_mismatch",
        orderItemId: sale.order_item_id,
      });
  }
  for (const reversal of reversals) {
    const expected = -Number(reversal.creator_net_reversed_cents);
    const entry = ledger.find(
      (row) =>
        row.entry_type === reversal.reversal_type &&
        Number(row.order_item_id) === Number(reversal.order_item_id) &&
        Number(row.amount_cents) === expected,
    );
    if (!entry)
      exceptions.push({
        code: "reversal_snapshot_ledger_mismatch",
        providerEventId: reversal.provider_event_id,
        orderItemId: reversal.order_item_id,
      });
  }
  for (const payout of payouts) {
    const entry = ledger.find(
      (row) =>
        row.entry_type === "payout" &&
        row.idempotency_key === `payout:${payout.idempotency_key}` &&
        Number(row.amount_cents) === -Number(payout.amount_cents),
    );
    if (!entry)
      exceptions.push({ code: "payout_ledger_mismatch", payoutId: payout.id });
  }
  const totals = {
    grossSalesCents: sum(sales, "gross_cents"),
    discountsCents: sum(sales, "discount_cents"),
    trgFeesCents: sum(sales, "marketplace_fee_cents"),
    creatorShareCents: sum(sales, "creator_net_cents"),
    refundsGrossCents: sum(
      reversals.filter((row) => row.reversal_type === "refund_reversal"),
      "gross_reversed_cents",
    ),
    refundsCreatorCents: sum(
      reversals.filter((row) => row.reversal_type === "refund_reversal"),
      "creator_net_reversed_cents",
    ),
    chargebacksGrossCents: sum(
      reversals.filter((row) => row.reversal_type === "chargeback_reversal"),
      "gross_reversed_cents",
    ),
    chargebacksCreatorCents: sum(
      reversals.filter((row) => row.reversal_type === "chargeback_reversal"),
      "creator_net_reversed_cents",
    ),
    netPayoutsCents: sum(
      payouts.filter((row) => row.status === "paid"),
      "amount_cents",
    ),
    ledgerNetCents: ledger.reduce(
      (total, row) => total + Number(row.amount_cents),
      0,
    ),
  };
  const currencies = [
    ...new Set(
      [...sales, ...reversals, ...ledger, ...payouts]
        .map((row) => String(row.currency || "").toUpperCase())
        .filter(Boolean),
    ),
  ];
  return {
    creatorId,
    period,
    totals,
    currencies,
    sales,
    reversals,
    payouts,
    ledger,
    reconciliation: { ok: exceptions.length === 0, exceptions },
  };
}

export function creatorBusinessReportCsv(creator, report) {
  if (!report.reconciliation.ok)
    throw new Error(
      "Business report does not reconcile to the immutable ledger.",
    );
  const headings = [
    "Date",
    "Record type",
    "Order reference",
    "Order ID",
    "Product/listing",
    "Quantity",
    "Gross cents",
    "Discount cents",
    "TRG fee cents",
    "Creator share cents",
    "Refund cents",
    "Chargeback cents",
    "Payout cents",
    "Ledger amount cents",
    "Currency",
    "Fee basis points",
    "Sale policy/split snapshot",
    "Status/reference",
  ];
  const lines = [
    ["Creator", creator.display_name],
    ["Creator ID", creator.id],
    ["Period", report.period.label],
    ["From", report.period.from],
    ["To", report.period.to],
    [],
    headings,
  ];
  for (const sale of report.sales)
    lines.push([
      sale.sold_at,
      "sale",
      sale.order_reference,
      sale.order_id,
      sale.listing_title || sale.product_title,
      sale.quantity,
      sale.gross_cents,
      sale.discount_cents,
      sale.marketplace_fee_cents,
      sale.creator_net_cents,
      0,
      0,
      0,
      sale.creator_net_cents,
      sale.currency,
      sale.fee_basis_points,
      sale.policy_reason,
      "",
    ]);
  for (const reversal of report.reversals)
    lines.push([
      reversal.created_at,
      reversal.reversal_type,
      reversal.order_reference,
      reversal.order_id,
      reversal.product_title,
      "",
      0,
      0,
      0,
      -Number(reversal.creator_net_reversed_cents),
      reversal.reversal_type === "refund_reversal"
        ? reversal.gross_reversed_cents
        : 0,
      reversal.reversal_type === "chargeback_reversal"
        ? reversal.gross_reversed_cents
        : 0,
      0,
      -Number(reversal.creator_net_reversed_cents),
      reversal.currency,
      reversal.fee_basis_points,
      reversal.policy_reason,
      reversal.provider_event_id,
    ]);
  for (const payout of report.payouts)
    lines.push([
      payout.paid_at,
      "payout",
      "",
      "",
      "",
      "",
      0,
      0,
      0,
      0,
      0,
      0,
      payout.amount_cents,
      -Number(payout.amount_cents),
      payout.currency,
      "",
      "",
      `${payout.status}: ${payout.reference}`,
    ]);
  for (const entry of report.ledger.filter((row) =>
    ["manual_adjustment", "payout_reversal"].includes(row.entry_type),
  ))
    lines.push([
      entry.created_at,
      entry.entry_type,
      "",
      entry.order_id || "",
      entry.product_slug || "",
      "",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      entry.amount_cents,
      entry.currency,
      "",
      "",
      entry.reason,
    ]);
  lines.push(
    [],
    ["Totals"],
    ["Gross sales cents", report.totals.grossSalesCents],
    ["Discounts cents", report.totals.discountsCents],
    ["TRG fees cents", report.totals.trgFeesCents],
    ["Creator share cents", report.totals.creatorShareCents],
    ["Refund gross cents", report.totals.refundsGrossCents],
    ["Chargeback gross cents", report.totals.chargebacksGrossCents],
    ["Net payouts cents", report.totals.netPayoutsCents],
    ["Ledger net movement cents", report.totals.ledgerNetCents],
    ["Reconciled", "yes"],
  );
  return lines.map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n";
}
function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}
async function rows(statement) {
  const result = await statement.all();
  return result.results || [];
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
