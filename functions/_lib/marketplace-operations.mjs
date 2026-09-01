import { runDueCreatorAudits } from "./creator-account-audits.mjs";
import { recordManualPayout } from "./creator-finance.mjs";
import { runPreferredBillingScheduler } from "./preferred-billing.mjs";

const iso = (n = Date.now()) => new Date(n).toISOString();
const rows = async (s) => (await s.all()).results || [];
const fail = (code, message) => Object.assign(new Error(message), { code });

async function notice(db, x) {
  const id = crypto.randomUUID(),
    now = x.now || iso();
  try {
    await db
      .prepare(
        `INSERT INTO marketplace_notice_outbox(id,audience_type,creator_id,user_id,order_id,remediation_case_id,payout_request_id,notice_type,subject,message,dedupe_key,available_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        x.audience,
        x.creatorId || null,
        x.userId || null,
        x.orderId || null,
        x.caseId || null,
        x.payoutRequestId || null,
        x.type,
        x.subject,
        x.message,
        x.key,
        now,
        now,
      )
      .run();
    return true;
  } catch (e) {
    if (/unique|constraint/i.test(String(e))) return false;
    throw e;
  }
}
async function audit(
  db,
  actorId,
  action,
  subjectType,
  subjectId,
  context = {},
  now = iso(),
) {
  await db
    .prepare(
      "INSERT INTO marketplace_operations_audit(actor_type,actor_id,action,subject_type,subject_id,context_json,created_at) VALUES('operator',?,?,?,?,?,?)",
    )
    .bind(
      actorId,
      action,
      subjectType,
      String(subjectId),
      JSON.stringify(context),
      now,
    )
    .run();
}

export async function openRemediation(
  db,
  {
    listingId,
    reason,
    requiredCorrection = "",
    notes = "",
    actorId = "operator",
    nowMs = Date.now(),
  } = {},
) {
  const listing = await db
    .prepare(
      "SELECT id,creator_id,title,source_product_slug FROM creator_listings WHERE id=?",
    )
    .bind(listingId)
    .first();
  if (!listing) throw fail("listing_missing", "Listing not found.");
  const now = iso(nowMs),
    due = iso(nowMs + 30 * 86400000),
    id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "UPDATE creator_listings SET publication_state='paused',lifecycle_state='paused',updated_at=? WHERE id=?",
      )
      .bind(now, listingId),
    db
      .prepare(
        "INSERT INTO product_remediation_cases(id,listing_id,status,defect_type,opened_at,repair_due_at,notes,required_correction) VALUES(?,?,'repair_open',?,?,?,?,?)",
      )
      .bind(
        id,
        listingId,
        reason,
        now,
        due,
        String(notes),
        String(requiredCorrection),
      ),
  ]);
  await notice(db, {
    audience: "creator",
    creatorId: listing.creator_id,
    caseId: id,
    type: "remediation_opened",
    subject: "Product repair required",
    message: `${listing.title} was delisted. Submit the required correction by ${due}.`,
    key: `remediation:${id}:opened`,
    now,
  });
  const affected = await rows(
    db
      .prepare(
        "SELECT DISTINCT o.id,o.user_id FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.payment_status='paid' AND oi.product_slug=?",
      )
      .bind(listing.source_product_slug),
  );
  for (const order of affected)
    await notice(db, {
      audience: "customer",
      userId: order.user_id,
      orderId: order.id,
      caseId: id,
      type: "remediation_choice",
      subject: "Choose a refund or wait for repair",
      message:
        "This product has been delisted for correction. You may request a refund now or retain access and wait for the corrected file.",
      key: `remediation:${id}:order:${order.id}:choice`,
      now,
    });
  await audit(
    db,
    actorId,
    "remediation_opened",
    "remediation",
    id,
    { listingId, reason, affectedOrders: affected.length },
    now,
  );
  return { id, repairDueAt: due, affectedOrders: affected.length };
}

export async function chooseRemediation(
  db,
  {
    caseId,
    orderId,
    userId = null,
    emailHash = "",
    choice,
    nowMs = Date.now(),
  } = {},
) {
  if (!["refund", "wait_for_repair"].includes(choice))
    throw fail("choice_invalid", "Choose refund or wait for repair.");
  const row = await db
    .prepare(
      `SELECT c.*,l.source_product_slug,l.title FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id JOIN order_items oi ON oi.product_slug=l.source_product_slug AND oi.order_id=? JOIN orders o ON o.id=oi.order_id WHERE c.id=? AND o.payment_status IN ('paid','refunded','disputed') AND ((? IS NOT NULL AND o.user_id=?) OR o.customer_email_hash=?) LIMIT 1`,
    )
    .bind(orderId, caseId, userId, userId, String(emailHash))
    .first();
  if (!row)
    throw fail(
      "not_affected",
      "This purchase is not eligible for this remediation choice.",
    );
  const now = iso(nowMs),
    id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO customer_refund_choices(id,remediation_case_id,order_id,user_id,customer_email_hash,choice,status,created_at,refund_required_at) VALUES(?,?,?,?,?,?,'pending',?,?) ON CONFLICT(remediation_case_id,order_id) DO UPDATE SET choice=excluded.choice,user_id=excluded.user_id,customer_email_hash=excluded.customer_email_hash,refund_required_at=excluded.refund_required_at`,
    )
    .bind(
      id,
      caseId,
      orderId,
      userId,
      String(emailHash),
      choice,
      now,
      choice === "refund" ? now : null,
    )
    .run();
  await notice(db, {
    audience: "customer",
    userId,
    orderId,
    caseId,
    type: choice === "refund" ? "refund_queued" : "wait_confirmed",
    subject: choice === "refund" ? "Refund queued" : "Repair wait confirmed",
    message:
      choice === "refund"
        ? "Your refund request is queued for safe provider processing."
        : "Your existing entitlement remains active while the correction is reviewed.",
    key: `remediation:${caseId}:order:${orderId}:${choice}`,
    now,
  });
  return { caseId, orderId, choice, refundRequired: choice === "refund" };
}

export async function submitRemediationCorrection(
  db,
  { caseId, creatorId, objectKey, nowMs = Date.now() } = {},
) {
  const c = await db
    .prepare(
      "SELECT c.*,l.creator_id FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id WHERE c.id=? AND l.creator_id=?",
    )
    .bind(caseId, creatorId)
    .first();
  if (!c || c.status !== "repair_open" || Date.parse(c.repair_due_at) < nowMs)
    throw fail(
      "remediation_unavailable",
      "This remediation cannot accept a correction.",
    );
  const now = iso(nowMs);
  await db
    .prepare(
      "UPDATE product_remediation_cases SET status='repaired_pending_review',correction_object_key=?,correction_submitted_at=?,compliance_result='pending' WHERE id=?",
    )
    .bind(String(objectKey), now, caseId)
    .run();
  await notice(db, {
    audience: "operator",
    caseId,
    type: "repair_submitted",
    subject: "Correction ready for review",
    message:
      "A Creator submitted a corrected product for ordinary compliance review.",
    key: `remediation:${caseId}:submitted:${now}`,
    now,
  });
  return { caseId, status: "repaired_pending_review" };
}

export async function reviewRemediationCorrection(
  db,
  { caseId, accepted, notes = "", actorId, nowMs = Date.now() } = {},
) {
  const c = await db
    .prepare(
      "SELECT c.*,l.creator_id,l.title,l.source_product_slug FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id WHERE c.id=?",
    )
    .bind(caseId)
    .first();
  if (!c || c.status !== "repaired_pending_review")
    throw fail(
      "review_unavailable",
      "No submitted correction is awaiting review.",
    );
  const now = iso(nowMs);
  if (accepted) {
    await db.batch([
      db
        .prepare(
          "UPDATE product_remediation_cases SET status='resolved',resolved_at=?,compliance_result='accepted',compliance_notes=?,compliance_reviewed_by=?,compliance_reviewed_at=? WHERE id=?",
        )
        .bind(now, String(notes), actorId, now, caseId),
      db
        .prepare(
          `UPDATE download_entitlements SET r2_object_key=? WHERE order_id IN (SELECT order_id FROM customer_refund_choices WHERE remediation_case_id=? AND choice='wait_for_repair') AND product_slug=? AND status='active'`,
        )
        .bind(c.correction_object_key, caseId, c.source_product_slug),
      db
        .prepare(
          "UPDATE customer_refund_choices SET status='replacement_delivered',resolved_at=? WHERE remediation_case_id=? AND choice='wait_for_repair'",
        )
        .bind(now, caseId),
    ]);
    for (const x of await rows(
      db
        .prepare(
          "SELECT order_id,user_id FROM customer_refund_choices WHERE remediation_case_id=? AND choice='wait_for_repair'",
        )
        .bind(caseId),
    ))
      await notice(db, {
        audience: "customer",
        userId: x.user_id,
        orderId: x.order_id,
        caseId,
        type: "repair_available",
        subject: "Corrected product available",
        message:
          "The accepted correction is available through your existing entitlement.",
        key: `remediation:${caseId}:order:${x.order_id}:available`,
        now,
      });
  } else
    await db
      .prepare(
        "UPDATE product_remediation_cases SET status='repair_open',compliance_result='rejected',compliance_notes=?,compliance_reviewed_by=?,compliance_reviewed_at=? WHERE id=?",
      )
      .bind(String(notes), actorId, now, caseId)
      .run();
  await notice(db, {
    audience: "creator",
    creatorId: c.creator_id,
    caseId,
    type: accepted ? "repair_accepted" : "repair_rejected",
    subject: accepted ? "Correction accepted" : "Correction needs more work",
    message: accepted
      ? "The correction passed compliance review. The listing remains delisted until ordinary publication review."
      : String(notes) || "The submitted correction was not acceptable.",
    key: `remediation:${caseId}:review:${now}`,
    now,
  });
  await audit(
    db,
    actorId,
    accepted ? "remediation_accepted" : "remediation_rejected",
    "remediation",
    caseId,
    {},
    now,
  );
  return { caseId, accepted };
}

export async function processExpiredRemediations(
  db,
  { nowMs = Date.now(), actorId = "scheduler" } = {},
) {
  const now = iso(nowMs),
    cases = await rows(
      db
        .prepare(
          "SELECT c.id,l.creator_id FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id WHERE c.status IN ('repair_open','repaired_pending_review') AND c.repair_due_at<=?",
        )
        .bind(now),
    );
  for (const c of cases) {
    await db.batch([
      db
        .prepare(
          "UPDATE product_remediation_cases SET status='expired',expired_processed_at=? WHERE id=? AND expired_processed_at IS NULL",
        )
        .bind(now, c.id),
      db
        .prepare(
          "UPDATE customer_refund_choices SET refund_required_at=COALESCE(refund_required_at,?) WHERE remediation_case_id=? AND choice='wait_for_repair' AND status='pending'",
        )
        .bind(now, c.id),
    ]);
    await notice(db, {
      audience: "creator",
      creatorId: c.creator_id,
      caseId: c.id,
      type: "remediation_expired",
      subject: "Product repair deadline expired",
      message:
        "Waiting customer purchases now require refund processing. The product remains delisted.",
      key: `remediation:${c.id}:expired`,
      now,
    });
    for (const x of await rows(
      db
        .prepare(
          "SELECT order_id,user_id FROM customer_refund_choices WHERE remediation_case_id=? AND choice='wait_for_repair'",
        )
        .bind(c.id),
    ))
      await notice(db, {
        audience: "customer",
        userId: x.user_id,
        orderId: x.order_id,
        caseId: c.id,
        type: "refund_required",
        subject: "Refund required after unsuccessful repair",
        message:
          "The repair deadline expired and your purchase is queued for required-refund processing.",
        key: `remediation:${c.id}:order:${x.order_id}:required-refund`,
        now,
      });
  }
  return { processed: cases.length };
}

export async function allocateProviderCost(
  db,
  {
    providerEventId,
    eventKind,
    orderId = null,
    creatorId = null,
    responsibility,
    actualCostCents,
    currency = "USD",
    actorId,
    reason,
    nowMs = Date.now(),
  } = {},
) {
  if (
    !["refund", "dispute"].includes(eventKind) ||
    !["creator", "marketplace"].includes(responsibility)
  )
    throw fail(
      "allocation_invalid",
      "Provider-cost responsibility must be explicit.",
    );
  const cost = Number(actualCostCents);
  if (!Number.isInteger(cost) || cost < 0)
    throw fail(
      "allocation_invalid",
      "Actual provider cost must be a nonnegative integer.",
    );
  if (responsibility === "creator" && !creatorId)
    throw fail(
      "allocation_invalid",
      "Creator responsibility requires a Creator.",
    );
  const now = iso(nowMs),
    id = crypto.randomUUID();
  let ledgerId = null;
  if (responsibility === "creator" && cost) {
    await db
      .prepare(
        "INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,order_id,available_at,payout_state,reason,idempotency_key,created_at) VALUES(?,'manual_adjustment',?,?,?,?, 'available',?,?,?)",
      )
      .bind(
        creatorId,
        -cost,
        String(currency).toUpperCase(),
        orderId,
        now,
        `Actual provider ${eventKind} cost; no markup`,
        `provider-cost:${eventKind}:${providerEventId}`,
        now,
      )
      .run();
    const l = await db
      .prepare("SELECT id FROM creator_earnings_ledger WHERE idempotency_key=?")
      .bind(`provider-cost:${eventKind}:${providerEventId}`)
      .first();
    ledgerId = l?.id || null;
  }
  await db
    .prepare(
      "INSERT INTO marketplace_provider_cost_allocations(id,provider_event_id,event_kind,order_id,creator_id,responsibility,actual_provider_cost_cents,currency,creator_ledger_id,classified_by,classification_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      providerEventId,
      eventKind,
      orderId,
      creatorId,
      responsibility,
      cost,
      String(currency).toUpperCase(),
      ledgerId,
      actorId,
      String(reason),
      now,
    )
    .run();
  await audit(
    db,
    actorId,
    "provider_cost_allocated",
    "provider_event",
    providerEventId,
    { eventKind, responsibility, actualCostCents: cost },
    now,
  );
  return {
    id,
    creatorLedgerId: ledgerId,
    actualCostCents: cost,
    responsibility,
  };
}

export async function createFraudBlock(
  db,
  {
    emailHash,
    userId = null,
    reason,
    evidence = {},
    actorId,
    nowMs = Date.now(),
  } = {},
) {
  if (!emailHash || !reason)
    throw fail("block_invalid", "Verified email hash and reason are required.");
  const now = iso(nowMs);
  const result = await db
    .prepare(
      "INSERT INTO marketplace_fraud_blocks(email_hash,user_id,status,reason,evidence_json,created_by,created_at) VALUES(?,?,'active',?,?,?,?)",
    )
    .bind(
      emailHash,
      userId,
      String(reason),
      JSON.stringify(evidence),
      actorId,
      now,
    )
    .run();
  if (userId)
    await db
      .prepare("UPDATE users SET status='disabled',updated_at=? WHERE id=?")
      .bind(now, userId)
      .run();
  await audit(
    db,
    actorId,
    "fraud_block_created",
    "fraud_block",
    result.meta?.last_row_id || emailHash,
    { userId },
    now,
  );
  return { blocked: true };
}
export async function reverseFraudBlock(
  db,
  { blockId, actorId, nowMs = Date.now() } = {},
) {
  const now = iso(nowMs),
    block = await db
      .prepare("SELECT * FROM marketplace_fraud_blocks WHERE id=?")
      .bind(blockId)
      .first();
  if (!block) throw fail("block_missing", "Fraud block not found.");
  await db
    .prepare(
      "UPDATE marketplace_fraud_blocks SET status='reversed',reversed_by=?,reversed_at=? WHERE id=? AND status='active'",
    )
    .bind(actorId, now, blockId)
    .run();
  if (block.user_id) {
    const other = await db
      .prepare(
        "SELECT id FROM marketplace_fraud_blocks WHERE user_id=? AND status='active' LIMIT 1",
      )
      .bind(block.user_id)
      .first();
    if (!other)
      await db
        .prepare(
          "UPDATE users SET status='active',updated_at=? WHERE id=? AND status='disabled'",
        )
        .bind(now, block.user_id)
        .run();
  }
  await audit(
    db,
    actorId,
    "fraud_block_reversed",
    "fraud_block",
    blockId,
    {},
    now,
  );
  return { reversed: true };
}
export async function recordRiskSignal(
  db,
  {
    subjectType,
    subjectReference,
    signalType,
    severity = "review",
    expiresAt = null,
    context = {},
    actorId,
    nowMs = Date.now(),
  } = {},
) {
  if (
    subjectType === "ip_network" &&
    !expiresAt &&
    severity === "temporary_block"
  )
    throw fail(
      "ip_not_identity",
      "An IP/network signal cannot create an indefinite block.",
    );
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO marketplace_risk_signals(id,subject_type,subject_reference,signal_type,severity,expires_at,context_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      subjectType,
      String(subjectReference),
      String(signalType),
      severity,
      expiresAt,
      JSON.stringify(context),
      actorId,
      iso(nowMs),
    )
    .run();
  return { id, permanentIdentityBlock: false };
}

export async function requestPayout(
  db,
  {
    creatorId,
    amountCents,
    currency = "USD",
    accountClosure = false,
    nowMs = Date.now(),
  } = {},
) {
  const now = iso(nowMs),
    balance = await db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN payout_state<>'held' AND available_at<=? THEN amount_cents ELSE 0 END),0) amount FROM creator_earnings_ledger WHERE creator_id=?",
      )
      .bind(now, creatorId)
      .first(),
    reserved = await db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) amount FROM creator_payout_reservations WHERE creator_id=? AND status='reserved'",
      )
      .bind(creatorId)
      .first(),
    held = await db
      .prepare("SELECT COALESCE(SUM(allocated_gross_cents),0) amount FROM creator_dispute_allocations WHERE creator_id=? AND status='held'")
      .bind(creatorId)
      .first(),
    available = Number(balance?.amount || 0) - Number(reserved?.amount || 0) - Number(held?.amount || 0),
    amount = accountClosure ? available : Number(amountCents);
  if (available <= 0)
    throw fail(
      "negative_balance",
      "No positive eligible balance is available.",
    );
  if (!accountClosure && amount < 1000)
    throw fail("minimum_payout", "Normal withdrawals require at least $10.");
  if (!Number.isInteger(amount) || amount <= 0 || amount > available)
    throw fail(
      "invalid_payout",
      "The requested payout exceeds the eligible balance.",
    );
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO creator_payout_requests(id,creator_id,amount_cents,currency,request_kind,status,requested_at) VALUES(?,?,?,?,?,'pending',?)",
        )
        .bind(
          id,
          creatorId,
          amount,
          String(currency).toUpperCase(),
          accountClosure ? "account_closure" : "normal",
          now,
        ),
      db
        .prepare(
          "INSERT INTO creator_payout_reservations(payout_request_id,creator_id,amount_cents,status,created_at) VALUES(?,?,?,'reserved',?)",
        )
        .bind(id, creatorId, amount, now),
    ]);
  } catch {
    throw fail(
      "payout_pending",
      "Only one payout request may be pending at a time.",
    );
  }
  await notice(db, {
    audience: "creator",
    creatorId,
    payoutRequestId: id,
    type: accountClosure ? "closure_payout_requested" : "payout_requested",
    subject: accountClosure ? "Final payout recorded" : "Payout requested",
    message:
      "The payout obligation is recorded. No external transfer occurs until an operator confirms provider execution.",
    key: `payout:${id}:requested`,
    now,
  });
  return { id, amountCents: amount, externalTransferExecuted: false };
}
export async function failPayout(
  db,
  { requestId, reason, actorId, nowMs = Date.now() } = {},
) {
  const now = iso(nowMs),
    r = await db
      .prepare(
        "SELECT * FROM creator_payout_requests WHERE id=? AND status IN ('pending','processing')",
      )
      .bind(requestId)
      .first();
  if (!r) throw fail("payout_unavailable", "Payout request is not pending.");
  await db.batch([
    db
      .prepare(
        "UPDATE creator_payout_requests SET status='failed',failure_reason=?,resolved_at=? WHERE id=?",
      )
      .bind(String(reason), now, requestId),
    db
      .prepare(
        "UPDATE creator_payout_reservations SET status='released',resolved_at=? WHERE payout_request_id=? AND status='reserved'",
      )
      .bind(now, requestId),
  ]);
  await notice(db, {
    audience: "creator",
    creatorId: r.creator_id,
    payoutRequestId: requestId,
    type: "payout_failed",
    subject: "Payout failed",
    message:
      "The payout failed; the reserved balance was released and can be requested again after the issue is corrected.",
    key: `payout:${requestId}:failed`,
    now,
  });
  await audit(
    db,
    actorId,
    "payout_failed",
    "payout_request",
    requestId,
    { reason },
    now,
  );
  return { failed: true, balancePreserved: true };
}

export async function completePayout(db,{requestId,reference,actorId,externalTransferConfirmed=false,nowMs=Date.now()}={}) {
  if (!externalTransferConfirmed) throw fail('transfer_unconfirmed','Record completion only after the external transfer is confirmed.');
  const request=await db.prepare("SELECT * FROM creator_payout_requests WHERE id=? AND status IN ('pending','processing')").bind(requestId).first();
  if(!request)throw fail('payout_unavailable','Payout request is not pending.');
  await recordManualPayout(db,{creatorId:request.creator_id,amountCents:Number(request.amount_cents),currency:request.currency,reference:String(reference),note:`Confirmed request ${requestId}`,idempotencyKey:`payout-request:${requestId}`,operatorActor:actorId,nowMs});
  const now=iso(nowMs);
  await db.batch([db.prepare("UPDATE creator_payout_requests SET status='paid',resolved_at=? WHERE id=?").bind(now,requestId),db.prepare("UPDATE creator_payout_reservations SET status='consumed',resolved_at=? WHERE payout_request_id=? AND status='reserved'").bind(now,requestId)]);
  await notice(db,{audience:'creator',creatorId:request.creator_id,payoutRequestId:requestId,type:'payout_completed',subject:'Payout completed',message:'The operator confirmed the external payout transfer.',key:`payout:${requestId}:completed`,now});
  await audit(db,actorId,'payout_completed','payout_request',requestId,{reference:String(reference)},now);
  return{paid:true,externalTransferConfirmed:true};
}

export async function runMarketplaceOperations(
  db,
  {
    env = {},
    nowMs = Date.now(),
    actorId = "operator",
    runKey = null,
    limit = 100,
  } = {},
) {
  const key = runKey || iso(nowMs).slice(0, 13),
    id = crypto.randomUUID(),
    now = iso(nowMs);
  try {
    await db
      .prepare(
        "INSERT INTO marketplace_scheduler_runs(id,job_name,run_key,status,started_at) VALUES(?,'marketplace_operations',?,'running',?)",
      )
      .bind(id, key, now)
      .run();
  } catch {
    return { duplicate: true, runKey: key };
  }
  try {
    const remediation = await processExpiredRemediations(db, {
        nowMs,
        actorId,
      }),
      audits = await runDueCreatorAudits(db, { env, nowMs, actorId, limit }),
      preferredBilling = await runPreferredBillingScheduler(db, {
        env,
        nowMs,
        limit,
      });
    const result = {
      remediation,
      audits,
      preferredBilling,
      nextRunAt: iso(nowMs + 3600000),
    };
    await db
      .prepare(
        "UPDATE marketplace_scheduler_runs SET status='completed',completed_at=?,result_json=? WHERE id=?",
      )
      .bind(iso(nowMs), JSON.stringify(result), id)
      .run();
    return { ...result, runKey: key };
  } catch (e) {
    await db
      .prepare(
        "UPDATE marketplace_scheduler_runs SET status='failed',completed_at=?,result_json=? WHERE id=?",
      )
      .bind(iso(nowMs), JSON.stringify({ error: e.message }), id)
      .run();
    throw e;
  }
}

export async function listOperations(db, { creatorId = null } = {}) {
  if (creatorId)
    return {
      remediations: await rows(
        db
          .prepare(
            `SELECT c.*,l.title,(SELECT COUNT(*) FROM customer_refund_choices x WHERE x.remediation_case_id=c.id AND x.choice='wait_for_repair') waiting_count,(SELECT COUNT(*) FROM customer_refund_choices x WHERE x.remediation_case_id=c.id AND x.refund_required_at IS NOT NULL) refund_required_count FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id WHERE l.creator_id=? ORDER BY c.opened_at DESC`,
          )
          .bind(creatorId),
      ),
      payoutRequests: await rows(
        db
          .prepare(
            "SELECT * FROM creator_payout_requests WHERE creator_id=? ORDER BY requested_at DESC",
          )
          .bind(creatorId),
      ),
    };
  return {
    remediations: await rows(
      db.prepare(
        `SELECT c.*,l.title,l.creator_id,(SELECT COUNT(*) FROM customer_refund_choices x WHERE x.remediation_case_id=c.id AND x.choice='wait_for_repair') waiting_count,(SELECT COUNT(*) FROM customer_refund_choices x WHERE x.remediation_case_id=c.id AND x.refund_required_at IS NOT NULL) refund_required_count FROM product_remediation_cases c JOIN creator_listings l ON l.id=c.listing_id ORDER BY c.opened_at DESC`,
      ),
    ),
    providerCosts: await rows(
      db.prepare(
        "SELECT * FROM marketplace_provider_cost_allocations ORDER BY created_at DESC",
      ),
    ),
    fraudBlocks: await rows(
      db.prepare(
        "SELECT id,user_id,status,reason,created_by,created_at,reversed_by,reversed_at FROM marketplace_fraud_blocks ORDER BY created_at DESC",
      ),
    ),
    riskSignals: await rows(
      db.prepare(
        "SELECT id,subject_type,signal_type,severity,expires_at,created_by,created_at FROM marketplace_risk_signals ORDER BY created_at DESC",
      ),
    ),
    payoutRequests: await rows(
      db.prepare(
        "SELECT * FROM creator_payout_requests ORDER BY requested_at DESC",
      ),
    ),
    refundsRequired: await rows(
      db.prepare(
        "SELECT remediation_case_id,order_id,choice,status,refund_required_at FROM customer_refund_choices WHERE refund_required_at IS NOT NULL ORDER BY refund_required_at",
      ),
    ),
    notices: await rows(
      db.prepare(
        "SELECT audience_type,notice_type,delivery_state,created_at FROM marketplace_notice_outbox ORDER BY created_at DESC LIMIT 100",
      ),
    ),
    schedulerRuns: await rows(
      db.prepare(
        "SELECT * FROM marketplace_scheduler_runs ORDER BY started_at DESC LIMIT 20",
      ),
    ),
  };
}
