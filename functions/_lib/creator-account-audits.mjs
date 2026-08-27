import { CREATOR_AGREEMENT } from "./creator-registration.mjs";
import { getCreatorTier } from "./marketplace-policy.mjs";

export const CREATOR_AUDIT_POLICY = Object.freeze({
  cadenceMonths: 6,
  developmentCureDays: 30,
  upcomingNoticeDays: 30,
  deadlineNoticeDays: 7,
});

export function resolveCreatorAuditPolicy(env = {}) {
  return {
    cadenceMonths: 6,
    cureDays: boundedInt(
      env.CREATOR_AUDIT_CURE_DAYS,
      1,
      180,
      CREATOR_AUDIT_POLICY.developmentCureDays,
    ),
    upcomingNoticeDays: boundedInt(
      env.CREATOR_AUDIT_UPCOMING_NOTICE_DAYS,
      1,
      90,
      CREATOR_AUDIT_POLICY.upcomingNoticeDays,
    ),
    deadlineNoticeDays: boundedInt(
      env.CREATOR_AUDIT_DEADLINE_NOTICE_DAYS,
      1,
      30,
      CREATOR_AUDIT_POLICY.deadlineNoticeDays,
    ),
  };
}
export function addUtcMonths(value, months) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Audit anchor is invalid.");
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, finalDay));
  return date.toISOString();
}

export async function runCreatorAudit(
  database,
  {
    creatorId,
    env = {},
    nowMs = Date.now(),
    actorType = "system",
    actorId = "scheduled_audit",
  } = {},
) {
  const now = new Date(nowMs).toISOString(),
    policy = resolveCreatorAuditPolicy(env),
    state = await database
      .prepare("SELECT * FROM creator_account_audit_states WHERE creator_id=?")
      .bind(creatorId)
      .first();
  if (!state) throw new Error("Creator audit state is unavailable.");
  if (state.state === "cure_required" || state.state === "restricted")
    return resolveCure(database, state, { env, nowMs, actorType, actorId });
  if (Date.parse(state.next_audit_due_at) > nowMs)
    return { notDue: true, nextAuditDueAt: state.next_audit_due_at };
  const existing = await database
    .prepare(
      "SELECT * FROM creator_account_audits WHERE creator_id=? AND cycle_due_at=?",
    )
    .bind(creatorId, state.next_audit_due_at)
    .first();
  if (existing?.completed_at) return { duplicate: true, audit: existing };
  const auditId = existing?.id || crypto.randomUUID();
  if (!existing)
    await database
      .prepare(
        "INSERT INTO creator_account_audits(id,creator_id,cycle_due_at,started_at,result,actor_type,actor_id,created_at) VALUES(?,?,?,?,'in_progress',?,?,?)",
      )
      .bind(
        auditId,
        creatorId,
        state.next_audit_due_at,
        now,
        actorType,
        actorId,
        now,
      )
      .run();
  const assessment = await assessCreatorAccount(database, creatorId, { nowMs });
  if (!assessment.reasonCodes.length) {
    const nextDue = addUtcMonths(now, policy.cadenceMonths);
    await database.batch([
      database
        .prepare(
          "UPDATE creator_account_audits SET completed_at=?,result='passed',reason_codes_json='[]',check_snapshot_json=? WHERE id=?",
        )
        .bind(now, JSON.stringify(assessment.checks), auditId),
      database
        .prepare(
          "UPDATE creator_account_audit_states SET state='passed',current_audit_id=?,cure_deadline_at=NULL,last_completed_at=?,last_result='passed',reason_codes_json='[]',restricted_at=NULL,next_audit_due_at=?,updated_at=? WHERE creator_id=?",
        )
        .bind(auditId, now, nextDue, now, creatorId),
      notice(database, {
        creatorId,
        ownerUserId: assessment.ownerUserId,
        auditId,
        type: "audit_passed",
        subject: "Creator account audit passed",
        message:
          "Your six-month Creator account maintenance audit is complete.",
        dedupe: `audit:${auditId}:passed`,
        now,
      }),
      action(database, {
        creatorId,
        auditId,
        actorType,
        actorId,
        actionName: "audit_passed",
        context: { nextDue },
        now,
      }),
    ]);
    return {
      auditId,
      result: "passed",
      nextAuditDueAt: nextDue,
      reasonCodes: [],
    };
  }
  const deadline = new Date(nowMs + policy.cureDays * 86400000).toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE creator_account_audits SET completed_at=?,result='cure_required',reason_codes_json=?,check_snapshot_json=?,cure_deadline_at=? WHERE id=?",
      )
      .bind(
        now,
        JSON.stringify(assessment.reasonCodes),
        JSON.stringify(assessment.checks),
        deadline,
        auditId,
      ),
    database
      .prepare(
        "UPDATE creator_account_audit_states SET state='cure_required',current_audit_id=?,cure_deadline_at=?,last_completed_at=?,last_result='cure_required',reason_codes_json=?,updated_at=? WHERE creator_id=?",
      )
      .bind(
        auditId,
        deadline,
        now,
        JSON.stringify(assessment.reasonCodes),
        now,
        creatorId,
      ),
    notice(database, {
      creatorId,
      ownerUserId: assessment.ownerUserId,
      auditId,
      type: "cure_required",
      subject: "Creator account maintenance required",
      message: `Resolve the listed account-maintenance items by ${deadline}.`,
      dedupe: `audit:${auditId}:cure`,
      now,
    }),
    action(database, {
      creatorId,
      auditId,
      actorType,
      actorId,
      actionName: "cure_required",
      context: { deadline, reasonCodes: assessment.reasonCodes },
      now,
    }),
  ]);
  return {
    auditId,
    result: "cure_required",
    cureDeadlineAt: deadline,
    reasonCodes: assessment.reasonCodes,
  };
}

export async function runDueCreatorAudits(
  database,
  { env = {}, nowMs = Date.now(), actorId = "scheduled_audit" } = {},
) {
  const now = new Date(nowMs).toISOString(),
    policy = resolveCreatorAuditPolicy(env),
    upcoming = new Date(
      nowMs + policy.upcomingNoticeDays * 86400000,
    ).toISOString(),
    states = await rows(
      database
        .prepare(
          "SELECT s.*,o.owner_user_id FROM creator_account_audit_states s JOIN creator_identity_ownership o ON o.creator_id=s.creator_id WHERE (s.state IN ('scheduled','passed') AND s.next_audit_due_at<=?) OR s.state IN ('cure_required','restricted') ORDER BY s.next_audit_due_at",
        )
        .bind(now),
    ),
    noticeStates = await rows(
      database
        .prepare(
          "SELECT s.*,o.owner_user_id FROM creator_account_audit_states s JOIN creator_identity_ownership o ON o.creator_id=s.creator_id WHERE s.state IN ('scheduled','passed') AND s.next_audit_due_at>? AND s.next_audit_due_at<=?",
        )
        .bind(now, upcoming),
    );
  for (const state of noticeStates)
    await notice(database, {
      creatorId: state.creator_id,
      ownerUserId: state.owner_user_id,
      type: "upcoming_audit",
      subject: "Creator account audit upcoming",
      message: `Your next operational account audit is scheduled for ${state.next_audit_due_at}.`,
      dedupe: `audit-upcoming:${state.creator_id}:${state.next_audit_due_at}`,
      now,
    }).run();
  const results = [];
  for (const state of states)
    results.push(
      await runCreatorAudit(database, {
        creatorId: state.creator_id,
        env,
        nowMs,
        actorId,
      }),
    );
  return { processed: results.length, results };
}

async function resolveCure(
  database,
  state,
  { env, nowMs, actorType, actorId },
) {
  const now = new Date(nowMs).toISOString(),
    policy = resolveCreatorAuditPolicy(env),
    assessment = await assessCreatorAccount(database, state.creator_id, {
      nowMs,
    }),
    auditId = state.current_audit_id;
  if (!assessment.reasonCodes.length) {
    const nextDue = addUtcMonths(now, policy.cadenceMonths);
    await database.batch([
      database
        .prepare(
          "UPDATE creator_account_audits SET result='cleared',completed_at=?,reason_codes_json='[]',check_snapshot_json=? WHERE id=?",
        )
        .bind(now, JSON.stringify(assessment.checks), auditId),
      database
        .prepare(
          "UPDATE creator_account_audit_states SET state='passed',cure_deadline_at=NULL,last_completed_at=?,last_result='cleared',reason_codes_json='[]',restricted_at=NULL,next_audit_due_at=?,updated_at=? WHERE creator_id=?",
        )
        .bind(now, nextDue, now, state.creator_id),
      database
        .prepare(
          "UPDATE creator_identity_ownership SET account_status='active',updated_at=? WHERE creator_id=? AND account_status='restricted'",
        )
        .bind(now, state.creator_id),
      database
        .prepare(
          "UPDATE marketplace_creators SET registration_status='active',updated_at=? WHERE id=? AND registration_status='restricted'",
        )
        .bind(now, state.creator_id),
      notice(database, {
        creatorId: state.creator_id,
        ownerUserId: assessment.ownerUserId,
        auditId,
        type: "cure_completed",
        subject: "Creator account maintenance complete",
        message:
          "Your account-maintenance issues are resolved and the audit restriction is cleared.",
        dedupe: `audit:${auditId}:cleared`,
        now,
      }),
      action(database, {
        creatorId: state.creator_id,
        auditId,
        actorType,
        actorId,
        actionName: "cure_completed",
        context: { nextDue },
        now,
      }),
    ]);
    return {
      auditId,
      result: "cleared",
      nextAuditDueAt: nextDue,
      reasonCodes: [],
    };
  }
  const deadlineMs = Date.parse(state.cure_deadline_at || "");
  if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
    await database.batch([
      database
        .prepare(
          "UPDATE creator_account_audits SET result='restricted',reason_codes_json=?,check_snapshot_json=? WHERE id=?",
        )
        .bind(
          JSON.stringify(assessment.reasonCodes),
          JSON.stringify(assessment.checks),
          auditId,
        ),
      database
        .prepare(
          "UPDATE creator_account_audit_states SET state='restricted',last_result='restricted',reason_codes_json=?,restricted_at=COALESCE(restricted_at,?),updated_at=? WHERE creator_id=?",
        )
        .bind(
          JSON.stringify(assessment.reasonCodes),
          now,
          now,
          state.creator_id,
        ),
      database
        .prepare(
          "UPDATE creator_identity_ownership SET account_status='restricted',updated_at=? WHERE creator_id=?",
        )
        .bind(now, state.creator_id),
      database
        .prepare(
          "UPDATE marketplace_creators SET registration_status='restricted',updated_at=? WHERE id=?",
        )
        .bind(now, state.creator_id),
      notice(database, {
        creatorId: state.creator_id,
        ownerUserId: assessment.ownerUserId,
        auditId,
        type: "restriction_applied",
        subject: "Creator account restricted",
        message:
          "The account-maintenance cure period expired. New paid publication and marketplace privileges are restricted; historical records and customer access remain preserved.",
        dedupe: `audit:${auditId}:restricted`,
        now,
      }),
      action(database, {
        creatorId: state.creator_id,
        auditId,
        actorType,
        actorId,
        actionName: "restriction_applied",
        context: { reasonCodes: assessment.reasonCodes },
        now,
      }),
    ]);
    return {
      auditId,
      result: "restricted",
      reasonCodes: assessment.reasonCodes,
    };
  }
  const approaching =
    Number.isFinite(deadlineMs) &&
    deadlineMs - nowMs <= policy.deadlineNoticeDays * 86400000;
  if (approaching)
    await notice(database, {
      creatorId: state.creator_id,
      ownerUserId: assessment.ownerUserId,
      auditId,
      type: "cure_deadline_approaching",
      subject: "Creator account cure deadline approaching",
      message: `Outstanding account-maintenance items are due by ${state.cure_deadline_at}.`,
      dedupe: `audit:${auditId}:deadline`,
      now,
    }).run();
  return {
    auditId,
    result: "cure_required",
    cureDeadlineAt: state.cure_deadline_at,
    reasonCodes: assessment.reasonCodes,
    duplicate: true,
  };
}

export async function assessCreatorAccount(
  database,
  creatorId,
  { nowMs = Date.now() } = {},
) {
  const creator = await database
      .prepare("SELECT * FROM marketplace_creators WHERE id=?")
      .bind(creatorId)
      .first(),
    owner = await database
      .prepare(
        "SELECT o.*,u.email_normalized,u.status user_status FROM creator_identity_ownership o LEFT JOIN users u ON u.id=o.owner_user_id WHERE o.creator_id=?",
      )
      .bind(creatorId)
      .first(),
    registration = await database
      .prepare("SELECT * FROM creator_registration_details WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    profile = owner
      ? await database
          .prepare(
            "SELECT payment_method_status FROM user_account_profiles WHERE user_id=?",
          )
          .bind(owner.owner_user_id)
          .first()
      : null,
    agreement = await database
      .prepare(
        "SELECT 1 ok FROM creator_agreement_acceptances WHERE creator_id=? AND agreement_id=? AND agreement_version=? AND superseded_at IS NULL",
      )
      .bind(creatorId, CREATOR_AGREEMENT.id, CREATOR_AGREEMENT.version)
      .first(),
    payout = await database
      .prepare("SELECT * FROM creator_payout_profiles WHERE creator_id=?")
      .bind(creatorId)
      .first(),
    paid = await database
      .prepare(
        "SELECT COUNT(*) n FROM creator_listings WHERE creator_id=? AND pricing_model<>'free' AND COALESCE(listed_price_cents,0)>0",
      )
      .bind(creatorId)
      .first(),
    risk = await database
      .prepare(
        "SELECT COUNT(*) n FROM creator_account_risk_flags WHERE creator_id=? AND status='open'",
      )
      .bind(creatorId)
      .first(),
    ownershipCount = owner
      ? await database
          .prepare(
            "SELECT COUNT(*) n FROM creator_identity_ownership WHERE creator_id=?",
          )
          .bind(creatorId)
          .first()
      : { n: 0 },
    ownerManagerMembership = await database
      .prepare(
        "SELECT COUNT(*) n FROM creator_identity_ownership o JOIN creator_memberships m ON m.creator_id=o.creator_id AND m.user_id=o.owner_user_id AND m.permission='manager' WHERE o.creator_id=?",
      )
      .bind(creatorId)
      .first(),
    tier = await getCreatorTier(database, creatorId, nowMs),
    checks = {
      accountExists: Boolean(
        owner?.owner_user_id && owner?.user_status === "active",
      ),
      contactValid: Boolean(
        registration && /^\S+@\S+\.\S+$/.test(registration.contact_email || ""),
      ),
      registrationComplete: Boolean(
        creator && registration && requiredRegistration(registration),
      ),
      paymentMethodReady: profile?.payment_method_status === "ready",
      payoutRequired: Number(paid?.n || 0) > 0,
      payoutReady: Boolean(
        payout?.onboarding_status === "complete" &&
        payout?.verification_status === "verified" &&
        Number(payout?.payouts_enabled) === 1,
      ),
      agreementCurrent: Boolean(agreement),
      identityEntitled: Boolean(
        owner &&
        owner.account_status !== "suspended" &&
        (owner.identity_type === "primary"
          ? ["not_required", "legacy_grandfathered"].includes(
              owner.billing_status,
            )
          : ["current", "legacy_grandfathered"].includes(owner.billing_status)),
      ),
      preferredCoherent: Boolean(
        !tier.preferred ||
        (tier.term?.status === "active" &&
          Date.parse(tier.term.term_ends_at) > nowMs),
      ),
      riskClear: Number(risk?.n || 0) === 0,
      ownershipValid: Number(ownershipCount?.n || 0) === 1,
      staffOwnershipSeparated: Number(ownerManagerMembership?.n || 0) === 1,
    };
  const reasons = [];
  for (const [key, ok] of Object.entries(checks)) {
    if (key === "payoutRequired") continue;
    if (key === "payoutReady" && !checks.payoutRequired) continue;
    if (!ok) reasons.push(REASONS[key] || key);
  }
  return {
    ownerUserId: owner?.owner_user_id || "",
    checks,
    reasonCodes: reasons,
  };
}

export async function listCreatorAuditOperations(
  database,
  { creatorId = "" } = {},
) {
  const where = creatorId ? "WHERE s.creator_id=?" : "",
    bind = creatorId ? [creatorId] : [];
  return {
    states: await rows(
      database
        .prepare(
          `SELECT s.*,c.slug,c.display_name,o.identity_type,o.billing_status,o.entitlement_source FROM creator_account_audit_states s JOIN marketplace_creators c ON c.id=s.creator_id LEFT JOIN creator_identity_ownership o ON o.creator_id=s.creator_id ${where} ORDER BY s.next_audit_due_at`,
        )
        .bind(...bind),
    ),
    history: await rows(
      database
        .prepare(
          `SELECT a.*,c.display_name FROM creator_account_audits a JOIN marketplace_creators c ON c.id=a.creator_id ${creatorId ? "WHERE a.creator_id=?" : ""} ORDER BY a.started_at DESC`,
        )
        .bind(...bind),
    ),
  };
}
export function assertAuditPrivilege(state) {
  if (state?.state === "restricted")
    throw new Error(
      "Creator account audit restriction blocks new paid publication or marketplace privileges.",
    );
}
export async function recordCreatorRiskFlag(
  database,
  { creatorId, reasonCode, note = "", actorId, nowMs = Date.now() } = {},
) {
  if (
    !creatorId ||
    !actorId ||
    !/^[a-z][a-z0-9_]{2,80}$/.test(String(reasonCode || ""))
  )
    throw new Error("Creator risk flag is invalid.");
  const id = crypto.randomUUID(),
    now = new Date(nowMs).toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO creator_account_risk_flags(id,creator_id,reason_code,note,status,created_by,created_at) VALUES(?,?,?,?,'open',?,?)",
      )
      .bind(
        id,
        creatorId,
        String(reasonCode),
        String(note).slice(0, 1000),
        actorId,
        now,
      ),
    action(database, {
      creatorId,
      auditId: null,
      actorType: "operator",
      actorId,
      actionName: "risk_flag_recorded",
      context: { riskFlagId: id, reasonCode },
      now,
    }),
  ]);
  return { id };
}
export async function resolveCreatorRiskFlag(
  database,
  { riskFlagId, actorId, nowMs = Date.now() } = {},
) {
  const now = new Date(nowMs).toISOString(),
    flag = await database
      .prepare(
        "SELECT * FROM creator_account_risk_flags WHERE id=? AND status='open'",
      )
      .bind(String(riskFlagId || ""))
      .first();
  if (!flag || !actorId)
    throw new Error("Open Creator risk flag was not found.");
  await database.batch([
    database
      .prepare(
        "UPDATE creator_account_risk_flags SET status='resolved',resolved_by=?,resolved_at=? WHERE id=? AND status='open'",
      )
      .bind(actorId, now, flag.id),
    action(database, {
      creatorId: flag.creator_id,
      auditId: null,
      actorType: "operator",
      actorId,
      actionName: "risk_flag_resolved",
      context: { riskFlagId: flag.id },
      now,
    }),
  ]);
  return { id: flag.id };
}
function notice(
  db,
  {
    creatorId,
    ownerUserId,
    auditId = null,
    type,
    subject,
    message,
    dedupe,
    now,
  },
) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO creator_account_notices(creator_id,owner_user_id,audit_id,notice_type,subject,message,dedupe_key,delivery_state,created_at) VALUES(?,?,?,?,?,?,?,'dashboard',?)",
    )
    .bind(creatorId, ownerUserId, auditId, type, subject, message, dedupe, now);
}
function action(
  db,
  { creatorId, auditId, actorType, actorId, actionName, context, now },
) {
  return db
    .prepare(
      "INSERT INTO creator_account_audit_actions(creator_id,audit_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      creatorId,
      auditId,
      actorType,
      actorId,
      actionName,
      JSON.stringify(context || {}),
      now,
    );
}
function requiredRegistration(r) {
  return Boolean(
    r.legal_name &&
    r.business_type &&
    r.country &&
    r.address_line1 &&
    r.city &&
    r.postal_code &&
    r.contact_email &&
    r.rights_confirmation_at,
  );
}
const REASONS = {
  accountExists: "account_missing_or_inactive",
  contactValid: "contact_email_invalid",
  registrationComplete: "registration_incomplete",
  paymentMethodReady: "payment_method_not_ready",
  payoutReady: "connect_payout_not_ready",
  agreementCurrent: "agreement_reacceptance_required",
  identityEntitled: "creator_entitlement_incoherent",
  preferredCoherent: "preferred_status_incoherent",
  riskClear: "account_risk_unresolved",
  ownershipValid: "ownership_invalid",
  staffOwnershipSeparated: "staff_ownership_conflict",
};
function boundedInt(v, min, max, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
async function rows(statement) {
  const result = await statement.all();
  return result.results || [];
}
