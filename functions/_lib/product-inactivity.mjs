import { assertPublicationCapacity } from "./marketplace-policy.mjs";
import { pauseListingPublication } from "./creator-publication.mjs";
import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";

export const INACTIVITY_POLICY = Object.freeze({
  calendarYears: 1,
  graceDays: 30,
  expiringNoticeDays: 7
});

export const RV_SAWYER_CREATOR_ID = "creator-rv-sawyer";
export const INACTIVITY_EXEMPTION_KINDS = Object.freeze([
  "none",
  "trg_house"
]);

const QUALIFYING_ACTIVITY_TYPES = new Set(["paid_sale", "pwyw_paid"]);
export async function recordQualifyingActivity(
  database,
  { orderId, nowMs = Date.now() } = {}
) {
  const now = new Date(nowMs).toISOString();
  const result = await rows(
    database
      .prepare(
        `SELECT oi.id order_item_id,oi.order_id,oi.product_slug,
          oi.line_total_cents,o.total_cents,o.paid_at,
          cl.id listing_id,cl.creator_id,cl.pricing_model,
          cl.inactivity_state,cl.inactivity_warning_started_at
        FROM order_items oi
        JOIN orders o ON o.id=oi.order_id
        JOIN creator_listings cl
          ON cl.source_product_slug=oi.product_slug
          OR cl.public_product_slug=oi.product_slug
        WHERE o.id=? AND o.payment_status='paid'`
      )
      .bind(Number(orderId))
  );
  let recorded = 0;
  let qualifying = 0;

  for (const item of result) {
    const existing = await database
      .prepare(
        "SELECT activity_type FROM creator_product_activity_events WHERE order_item_id=?"
      )
      .bind(item.order_item_id)
      .first();
    if (existing) continue;

    const type = activityType(item);
    const occurred = item.paid_at || now;
    const qualifies =
      QUALIFYING_ACTIVITY_TYPES.has(type) &&
      Number(item.total_cents) > 0 &&
      Number(item.line_total_cents) > 0;
    const statements = [
      database
        .prepare(
          "INSERT OR IGNORE INTO creator_product_activity_events(listing_id,order_id,order_item_id,activity_type,occurred_at,created_at) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          item.listing_id,
          item.order_id,
          item.order_item_id,
          type,
          occurred,
          now
        )
    ];

    if (qualifies) {
      qualifying += 1;
      const clearsWarning =
        item.inactivity_state === "warning" &&
        item.inactivity_warning_started_at &&
        Date.parse(occurred) >= Date.parse(item.inactivity_warning_started_at);
      statements.push(
        database
          .prepare(
            `UPDATE creator_listings
             SET last_qualifying_activity_at=CASE
                   WHEN last_qualifying_activity_at IS NULL
                     OR last_qualifying_activity_at<? THEN ?
                   ELSE last_qualifying_activity_at
                 END,
                 inactivity_state=CASE WHEN ? THEN 'active' ELSE inactivity_state END,
                 inactivity_warning_started_at=CASE WHEN ? THEN NULL ELSE inactivity_warning_started_at END,
                 inactivity_grace_ends_at=CASE WHEN ? THEN NULL ELSE inactivity_grace_ends_at END
             WHERE id=?`
          )
          .bind(
            occurred,
            occurred,
            clearsWarning ? 1 : 0,
            clearsWarning ? 1 : 0,
            clearsWarning ? 1 : 0,
            item.listing_id
          )
      );
      if (clearsWarning) {
        statements.push(
          notice(
            database,
            item,
            "inactivity_cleared",
            `cleared:${item.listing_id}:${occurred}`,
            { occurredAt: occurred },
            now
          ),
          audit(
            database,
            item,
            "system",
            "inactivity_warning_cleared",
            { occurredAt: occurred, activityType: type },
            now
          )
        );
      }
    }

    await database.batch(statements);
    recorded += 1;
  }

  return { recorded, qualifying };
}
export async function runInactivityCheck(
  database,
  {
    nowMs = Date.now(),
    env = {},
    dispatchOptions = {},
    getCatalogProduct = getRuntimeCatalogProduct,
    pausePublication = pauseListingPublication
  } = {}
) {
  const now = new Date(nowMs).toISOString();
  const historicOrders = await rows(
    database.prepare(
      `SELECT DISTINCT o.id
       FROM orders o
       JOIN order_items oi ON oi.order_id=o.id
       JOIN creator_listings cl
         ON cl.source_product_slug=oi.product_slug
         OR cl.public_product_slug=oi.product_slug
       WHERE o.payment_status='paid'`
    )
  );
  for (const order of historicOrders)
    await recordQualifyingActivity(database, { orderId: order.id, nowMs });

  const list = await rows(
    database.prepare(
      `SELECT cl.*,
        EXISTS(
          SELECT 1 FROM creator_badge_awards a
          WHERE a.creator_id=cl.creator_id
            AND a.badge_id='founding-creator'
            AND a.state='active'
        ) is_founding_creator
       FROM creator_listings cl
       WHERE cl.publication_state='published'
          OR cl.inactivity_state='warning'
       ORDER BY cl.id`
    )
  );
  const summary = {
    checked: list.length,
    founderExempt: 0,
    rvSawyerExempt: 0,
    houseExempt: 0,
    warnings: 0,
    cleared: 0,
    pending: 0,
    inactivated: 0,
    errors: []
  };

  for (const item of list) {
    try {
      const exemption = inactivityExemptionFor(item);
      if (exemption) {
        if (exemption === "founding_creator") summary.founderExempt += 1;
        if (exemption === "rv_sawyer") summary.rvSawyerExempt += 1;
        if (exemption === "trg_house") summary.houseExempt += 1;
        if (item.inactivity_state === "warning") {
          await clearWarning(database, item, now, `${exemption}_exemption`);
          summary.cleared += 1;
        }
        continue;
      }
      if (
        item.publication_state !== "published" &&
        item.inactivity_state !== "warning"
      )
        continue;

      const latest = await database
        .prepare(
          `SELECT MAX(CASE
                    WHEN activity_type IN ('paid_sale','pwyw_paid')
                    THEN occurred_at
                  END) occurred_at,
                  COUNT(*) event_count
           FROM creator_product_activity_events
           WHERE listing_id=?`
        )
        .bind(item.id)
        .first();
      const qualifyingActivityAt =
        latest?.occurred_at ||
        (Number(latest?.event_count || 0) === 0
          ? item.last_qualifying_activity_at
          : null);
      const baseline = latestTimestamp(
        item.first_published_at,
        qualifyingActivityAt
      );
      const anniversary = oneCalendarYearAfter(baseline);
      if (!anniversary) {
        summary.errors.push({
          listingId: item.id,
          code: "missing_activity_baseline"
        });
        await insertNotice(
          database,
          item,
          "lifecycle_error",
          `baseline:${item.id}`,
          { code: "missing_activity_baseline" },
          now
        );
        continue;
      }

      if (nowMs < Date.parse(anniversary)) {
        if (item.inactivity_state === "warning") {
          await clearWarning(
            database,
            item,
            now,
            "qualifying_paid_sale",
            baseline
          );
          summary.cleared += 1;
        }
        continue;
      }

      if (item.inactivity_state === "active") {
        const graceEndsAt = new Date(
          nowMs + INACTIVITY_POLICY.graceDays * 86400000
        ).toISOString();
        await database.batch([
          database
            .prepare(
              `UPDATE creator_listings
               SET inactivity_state='warning',last_qualifying_activity_at=?,
                   inactivity_warning_started_at=?,inactivity_grace_ends_at=?
               WHERE id=? AND inactivity_state='active'`
            )
            .bind(baseline, now, graceEndsAt, item.id),
          notice(
            database,
            item,
            "inactivity_warning",
            `warning:${item.id}:${baseline}`,
            { lastActivityAt: baseline, anniversary, graceEndsAt },
            now
          ),
          audit(
            database,
            item,
            "system",
            "inactivity_warning_entered",
            { lastActivityAt: baseline, anniversary, graceEndsAt },
            now
          )
        ]);
        summary.warnings += 1;
        continue;
      }

      if (item.inactivity_grace_ends_at > now) {
        if (
          Date.parse(item.inactivity_grace_ends_at) - nowMs <=
          INACTIVITY_POLICY.expiringNoticeDays * 86400000
        )
          await insertNotice(
            database,
            item,
            "warning_expiring",
            `expiring:${item.id}:${item.inactivity_warning_started_at}`,
            { graceEndsAt: item.inactivity_grace_ends_at },
            now
          );
        continue;
      }

      const catalogProduct = await getCatalogProduct(item.public_product_slug);
      if (isConfirmedUnavailable(catalogProduct)) {
        await finalizeInactivity(database, item, now);
        summary.inactivated += 1;
        continue;
      }

      if (
        item.publication_state !== "published" ||
        item.lifecycle_state !== "active"
      ) {
        summary.pending += 1;
        continue;
      }

      const response = await pausePublication({
        listing: item,
        database,
        env,
        actorType: "system",
        actorId: "product-inactivity",
        nowMs,
        dispatchOptions
      });
      const outcome = await response.json();
      if (!response.ok || !outcome.ok) {
        summary.errors.push({
          listingId: item.id,
          code: "catalog_pause_failed"
        });
        await insertNotice(
          database,
          item,
          "lifecycle_error",
          `pause-failed:${item.id}:${item.inactivity_warning_started_at}`,
          { code: "catalog_pause_failed", message: outcome.error || "" },
          now
        );
        continue;
      }

      if (outcome.pending) {
        await database.batch([
          database
            .prepare(
              "UPDATE creator_listings SET publication_state='publishing',updated_at=? WHERE id=? AND publication_state='published'"
            )
            .bind(now, item.id),
          audit(
            database,
            item,
            "system",
            "inactivity_pause_dispatched",
            { runUrl: outcome.runUrl || "" },
            now
          )
        ]);
      }

      const refreshedCatalogProduct = await getCatalogProduct(
        item.public_product_slug
      );
      if (isConfirmedUnavailable(refreshedCatalogProduct)) {
        await finalizeInactivity(database, item, now);
        summary.inactivated += 1;
      } else {
        summary.pending += 1;
      }
    } catch (error) {
      summary.errors.push({ listingId: item.id, code: "lifecycle_error" });
      await insertNotice(
        database,
        item,
        "lifecycle_error",
        `error:${item.id}:${item.inactivity_warning_started_at || now}`,
        { code: "lifecycle_error", message: String(error?.message || "") },
        now
      ).catch(() => {});
    }
  }

  return summary;
}
export async function setListingInactivityExemption(
  database,
  {
    listingId,
    exemptionKind = "none",
    actorId,
    nowMs = Date.now()
  } = {}
) {
  const id = String(listingId || "").trim();
  const nextKind = String(exemptionKind || "none").trim();
  const operator = String(actorId || "").trim();
  if (!id) throw new Error("Listing ID is required.");
  if (!operator) throw new Error("Authenticated Owner identity is required.");
  if (!INACTIVITY_EXEMPTION_KINDS.includes(nextKind))
    throw new Error("Inactivity exemption kind is invalid.");

  const listing = await database
    .prepare("SELECT * FROM creator_listings WHERE id=?")
    .bind(id)
    .first();
  if (!listing) throw new Error("Creator listing was not found.");
  const previousKind = String(listing.inactivity_exemption_kind || "none");
  if (previousKind === nextKind)
    return { listingId: id, exemptionKind: nextKind, changed: false };

  const now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const clearingWarning =
    nextKind === "trg_house" && listing.inactivity_state === "warning";
  const statements = [
    database
      .prepare(
        `UPDATE creator_listings
         SET inactivity_exemption_kind=?,
             inactivity_state=CASE WHEN ? THEN 'active' ELSE inactivity_state END,
             inactivity_warning_started_at=CASE WHEN ? THEN NULL ELSE inactivity_warning_started_at END,
             inactivity_grace_ends_at=CASE WHEN ? THEN NULL ELSE inactivity_grace_ends_at END,
             updated_at=?
         WHERE id=?`
      )
      .bind(
        nextKind,
        clearingWarning ? 1 : 0,
        clearingWarning ? 1 : 0,
        clearingWarning ? 1 : 0,
        now,
        id
      ),
    database
      .prepare(
        `INSERT INTO creator_publication_audit(
          listing_id,creator_id,actor_type,actor_id,action,context_json,created_at
        ) VALUES(?,?,'operator',?,'inactivity_exemption_changed',?,?)`
      )
      .bind(
        id,
        listing.creator_id,
        operator,
        JSON.stringify({ previousKind, exemptionKind: nextKind }),
        now
      )
  ];
  if (clearingWarning)
    statements.push(
      notice(
        database,
        listing,
        "inactivity_cleared",
        `cleared:${id}:trg_house_exemption:${now}`,
        { reason: "trg_house_exemption" },
        now
      )
    );
  await database.batch(statements);
  return { listingId: id, exemptionKind: nextKind, changed: true };
}
export async function reactivateListing(database,{listingId,creatorId,actorId,nowMs=Date.now()}={}){const listing=await database.prepare('SELECT * FROM creator_listings WHERE id=? AND creator_id=?').bind(String(listingId),String(creatorId)).first();if(!listing||listing.inactivity_state!=='inactive')throw new Error('Inactive listing not found.');const eligibleAt=oneCalendarMonthAfter(listing.inactivity_transitioned_at);if(!eligibleAt||nowMs<Date.parse(eligibleAt))throw new Error(`An inactivity-delisted product must remain off sale until ${eligibleAt||'its relisting date'}.`);await assertPublicationCapacity(database,listing,nowMs);if(listing.listed_price_cents===null||Number(listing.listed_price_cents)<0)throw new Error('Current pricing is invalid.');const file=listing.media_type==='physical'?{ok:1}:await database.prepare("SELECT 1 ok FROM creator_listing_files WHERE listing_id=? AND purpose='product' AND validation_state='accepted' AND delivery_object_key IS NOT NULL LIMIT 1").bind(listing.id).first();if(!file)throw new Error('Secure delivery files require compliance revalidation.');const now=new Date(nowMs).toISOString();await database.batch([database.prepare("UPDATE creator_listings SET inactivity_state='active',publication_state='approved',lifecycle_state='active',inactivity_warning_started_at=NULL,inactivity_grace_ends_at=NULL,inactivity_reactivated_at=?,updated_at=? WHERE id=? AND inactivity_state='inactive'").bind(now,now,listing.id),notice(database,listing,'reactivated',`reactivated:${listing.id}:${now}`,{firstPublishedAt:listing.first_published_at,eligibleAt},now),audit(database,listing,String(actorId||creatorId),'reactivated',{firstPublishedAt:listing.first_published_at,eligibleAt},now)]);return{listingId:listing.id,state:'compliance_revalidation_ready',firstPublishedAt:listing.first_published_at,eligibleAt};}
export async function listInactivityOperations(database){return{warnings:await rows(database.prepare("SELECT id,creator_id,title,last_qualifying_activity_at,inactivity_warning_started_at,inactivity_grace_ends_at FROM creator_listings WHERE inactivity_state='warning' ORDER BY inactivity_grace_ends_at")),recentInactive:await rows(database.prepare("SELECT id,creator_id,title,inactivity_transitioned_at FROM creator_listings WHERE inactivity_state='inactive' ORDER BY inactivity_transitioned_at DESC LIMIT 100")),recentReactivated:await rows(database.prepare("SELECT id,creator_id,title,inactivity_reactivated_at FROM creator_listings WHERE inactivity_reactivated_at IS NOT NULL ORDER BY inactivity_reactivated_at DESC LIMIT 100")),lifecycleErrors:await rows(database.prepare("SELECT n.listing_id id,n.creator_id,cl.title,n.created_at,n.context_json FROM creator_lifecycle_notices n JOIN creator_listings cl ON cl.id=n.listing_id WHERE n.notice_type='lifecycle_error' ORDER BY n.created_at DESC LIMIT 100"))};}
export function oneCalendarYearAfter(value) {
  return addCalendarYears(value, INACTIVITY_POLICY.calendarYears);
}

function activityType(item) {
  if (item.pricing_model === "pwyw")
    return Number(item.line_total_cents) > 0 ? "pwyw_paid" : "pwyw_free";
  return item.pricing_model === "free" || Number(item.line_total_cents) <= 0
    ? "free_acquisition"
    : "paid_sale";
}

function inactivityExemptionFor(item) {
  if (Number(item.is_founding_creator) === 1) return "founding_creator";
  if (item.creator_id === RV_SAWYER_CREATOR_ID) return "rv_sawyer";
  if (item.inactivity_exemption_kind === "trg_house") return "trg_house";
  return "";
}

async function clearWarning(database, item, now, reason, baseline = null) {
  const activityAt = baseline || item.last_qualifying_activity_at;
  await database.batch([
    database
      .prepare(
        `UPDATE creator_listings
         SET inactivity_state='active',
             last_qualifying_activity_at=COALESCE(?,last_qualifying_activity_at),
             inactivity_warning_started_at=NULL,inactivity_grace_ends_at=NULL
         WHERE id=? AND inactivity_state='warning'`
      )
      .bind(activityAt, item.id),
    notice(
      database,
      item,
      "inactivity_cleared",
      `cleared:${item.id}:${reason}:${activityAt || now}`,
      { reason, occurredAt: activityAt },
      now
    ),
    audit(
      database,
      item,
      "system",
      "inactivity_warning_cleared",
      { reason, occurredAt: activityAt },
      now
    )
  ]);
}

async function finalizeInactivity(database, item, now) {
  await database.batch([
    database
      .prepare(
        `UPDATE creator_listings
         SET inactivity_state='inactive',publication_state='paused',
             lifecycle_state='paused',inactivity_transitioned_at=?,updated_at=?
         WHERE id=? AND inactivity_state='warning'`
      )
      .bind(now, now, item.id),
    notice(
      database,
      item,
      "inactivated",
      `inactive:${item.id}:${item.inactivity_warning_started_at}`,
      { graceEndedAt: item.inactivity_grace_ends_at },
      now
    ),
    audit(
      database,
      item,
      "system",
      "inactivity_transitioned",
      { graceEndedAt: item.inactivity_grace_ends_at },
      now
    )
  ]);
}

function isConfirmedUnavailable(product) {
  if (!product) return false;
  return (
    product.saleEnabled === false ||
    product.buyMode === "retired" ||
    product.status === "legacy-not-for-sale" ||
    product.status === "retired"
  );
}

function addCalendarYears(value, years) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(month);
  date.setUTCDate(
    Math.min(
      day,
      new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate()
    )
  );
  return date.toISOString();
}

function latestTimestamp(...values) {
  const valid = values
    .map((value) => ({ value, time: Date.parse(value || "") }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time);
  return valid[0]?.value || "";
}

function notice(db,item,type,key,context,now){return db.prepare("INSERT OR IGNORE INTO creator_lifecycle_notices(listing_id,creator_id,notice_type,dedupe_key,context_json,created_at) VALUES(?,?,?,?,?,?)").bind(item.id||item.listing_id,item.creator_id,type,key,JSON.stringify(context),now);}async function insertNotice(db,item,type,key,context,now){await notice(db,item,type,key,context,now).run();}function audit(db,item,actor,action,context,now){const actorType=actor==='system'?'system':'creator';return db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(item.id||item.listing_id,item.creator_id,actorType,actor,action,JSON.stringify(context),now);}async function rows(statement){const result=await statement.all();return result.results||[];}function oneCalendarMonthAfter(value){const date=new Date(value||'');if(!Number.isFinite(date.getTime()))return'';const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));return date.toISOString();}
