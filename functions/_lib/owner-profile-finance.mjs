import { getCreatorLiability, getTrgRevenueReport } from "./creator-liability.mjs";

export async function ownerProfileFinancials(db, creatorId, userId, nowMs=Date.now()) {
  await assertOwnerIdentity(db, creatorId, userId);
  const liability=await getCreatorLiability(db,creatorId,{nowMs}), revenue=await getTrgRevenueReport(db);
  return {liability,revenue,creatorAdjustments:await rows(db.prepare("SELECT * FROM creator_fund_target_adjustments WHERE creator_id=? ORDER BY created_at DESC").bind(creatorId)),revenueAdjustments:await rows(db.prepare("SELECT * FROM trg_revenue_adjustments ORDER BY created_at DESC"))};
}
export async function adjustOwnerCreatorFunds(db,{creatorId,userId,newTotalCents,reason,nowMs=Date.now()}={}){
  await assertOwnerIdentity(db,creatorId,userId); const desired=integer(newTotalCents),detail=required(reason),before=(await getCreatorLiability(db,creatorId,{nowMs})).currentNetLiabilityCents,delta=desired-before,id=crypto.randomUUID(),now=new Date(nowMs).toISOString(),key=`owner-target-adjustment:${id}`;
  await db.prepare("INSERT INTO creator_earnings_ledger(creator_id,entry_type,amount_cents,currency,available_at,payout_state,reason,operator_actor,idempotency_key,created_at) VALUES(?,'manual_adjustment',?,'USD',?,'available',?,?,?,?)").bind(creatorId,delta,now,detail,userId,key,now).run();
  const ledger=await db.prepare("SELECT id FROM creator_earnings_ledger WHERE idempotency_key=?").bind(key).first();
  await db.prepare("INSERT INTO creator_fund_target_adjustments(id,creator_id,ledger_entry_id,previous_total_cents,new_total_cents,delta_cents,reason,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,creatorId,ledger.id,before,desired,delta,detail,userId,now).run();
  return {id,previousTotalCents:before,newTotalCents:desired,deltaCents:delta};
}
export async function adjustTrgRevenue(db,{creatorId,userId,newTotalCents,reason,nowMs=Date.now()}={}){
  await assertOwnerIdentity(db,creatorId,userId);const desired=integer(newTotalCents),detail=required(reason),report=await getTrgRevenueReport(db),before=report.netRetainedRevenueCents,delta=desired-before,id=crypto.randomUUID(),now=new Date(nowMs).toISOString();
  await db.prepare("INSERT INTO trg_revenue_adjustments(id,previous_total_cents,new_total_cents,delta_cents,reason,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,before,desired,delta,detail,userId,now).run();return{id,previousTotalCents:before,newTotalCents:desired,deltaCents:delta};
}
async function assertOwnerIdentity(db,creatorId,userId){const row=await db.prepare("SELECT 1 ok FROM users u JOIN creator_identity_ownership o ON o.owner_user_id=u.id WHERE u.id=? AND u.role IN ('owner','admin') AND o.creator_id=? AND o.identity_type='primary'").bind(userId,creatorId).first();if(!row)throw new Error("Owner primary Creator identity could not be resolved unambiguously.");}
const integer=x=>{x=Number(x);if(!Number.isInteger(x))throw new Error("Financial target must use integer cents.");return x},required=x=>{x=String(x||'').trim();if(x.length<3)throw new Error("A human-readable adjustment reason is required.");return x.slice(0,1000)},rows=async s=>(await s.all()).results||[];
