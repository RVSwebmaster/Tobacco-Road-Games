import {getCreatorFinance,getOperatorFinance,recordFeePolicy,recordManualAdjustment,recordManualPayout,reconcileCreatorFinance,setCreatorLedgerHold} from './creator-finance.mjs';
import {getOwnerSecrets,readCookie,SESSION_COOKIE_NAME,verifySessionToken} from './owner-auth.mjs';
import {verifyAuthenticatedOwnerMutationRequest} from './owner-mutation-auth.mjs';
import {getCreatorPayoutStatus,getOperatorPayoutReadiness,reconcileProviderFinance} from './creator-payout-readiness.mjs';

export async function handleCreatorFinanceOwnerRequest(request,env={},options={}){
 const db=options.database||env.TRG_ORDERS;
 if(request.method==='GET'){
  const secrets=getOwnerSecrets(env),auth=await verifySessionToken(readCookie(request,SESSION_COOKIE_NAME),secrets.sessionSecret,options.nowMs||Date.now());
  if(!auth.valid)return json({error:'Operator access required.'},403);
  const creatorId=new URL(request.url).searchParams.get('creator');
  if(creatorId)return json({...await getCreatorFinance(db,creatorId,{nowMs:options.nowMs}),payout:await getCreatorPayoutStatus(db,creatorId,{env,nowMs:options.nowMs})});const finance=await getOperatorFinance(db,{nowMs:options.nowMs}),payout=await getOperatorPayoutReadiness(db,{env,nowMs:options.nowMs});return json({...finance,...payout,providerReconciliation:await reconcileProviderFinance(db)});
 }
 if(request.method!=='POST')return json({error:'Use GET or POST.'},405);
 const auth=await verifyAuthenticatedOwnerMutationRequest(request,env);if(!auth.valid)return json({error:auth.userMessage},auth.status);let body={};try{body=await request.json();}catch{}
 if(body.action==='reconcile')return json({exceptions:await reconcileCreatorFinance(db)});
 try{
  if(body.action==='record_payout'){const readiness=await getCreatorPayoutStatus(db,String(body.creatorId||''),{env,nowMs:options.nowMs});if(!readiness.eligible)throw new Error(`Payout is blocked: ${readiness.blockedReasons.join(' ')}`);return json({ok:true,...await recordManualPayout(db,{...body,operatorActor:auth.username})});}
  if(body.action==='update_payout_profile')return json({ok:true,...await updatePayoutProfile(db,{...body,operatorActor:auth.username})});
  if(body.action==='manual_adjustment')return json({ok:true,...await recordManualAdjustment(db,{...body,operatorActor:auth.username})});
  if(body.action==='set_hold')return json({ok:true,...await setCreatorLedgerHold(db,{...body,operatorActor:auth.username})});
  if(body.action==='record_fee_policy')return json({ok:true,...await recordFeePolicy(db,{...body,operatorActor:auth.username})});
  return json({error:'Finance action is invalid.'},400);
 }catch(error){return json({error:error.message},409);}
}
async function updatePayoutProfile(db,input){const allowedProviders=['manual','stripe_connect','paypal','ach_provider'],allowedOnboarding=['not_started','pending','complete','restricted'],allowedVerification=['unverified','pending','verified','restricted'],creatorId=String(input.creatorId||''),provider=String(input.provider||'manual'),onboarding=String(input.onboardingStatus||'not_started'),verification=String(input.verificationStatus||'unverified'),reference=String(input.providerAccountReference||'').trim().slice(0,255),country=String(input.country||'').toUpperCase().slice(0,2),currency=String(input.currency||'USD').toUpperCase(),hold=String(input.operatorHoldReason||'').trim().slice(0,1000),enabled=input.payoutsEnabled?1:0,now=new Date().toISOString();if(!creatorId||!allowedProviders.includes(provider)||!allowedOnboarding.includes(onboarding)||!allowedVerification.includes(verification)||currency.length!==3)throw new Error('Payout profile is invalid.');await db.batch([db.prepare(`INSERT INTO creator_payout_profiles(creator_id,provider,provider_account_reference,onboarding_status,payouts_enabled,verification_status,country,currency,operator_hold_reason,status_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET provider=excluded.provider,provider_account_reference=excluded.provider_account_reference,onboarding_status=excluded.onboarding_status,payouts_enabled=excluded.payouts_enabled,verification_status=excluded.verification_status,country=excluded.country,currency=excluded.currency,operator_hold_reason=excluded.operator_hold_reason,status_updated_at=excluded.status_updated_at`).bind(creatorId,provider,reference,onboarding,enabled,verification,country,currency,hold,now),db.prepare("INSERT INTO creator_financial_audit(creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,'operator',?,'payout_profile_updated',?,?)").bind(creatorId,input.operatorActor,JSON.stringify({provider,onboardingStatus:onboarding,payoutsEnabled:Boolean(enabled),verificationStatus:verification,country,currency,held:Boolean(hold)}),now)]);return{creatorId};}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8'}});}
