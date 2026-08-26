import {getCreatorFinance,getOperatorFinance,recordFeePolicy,recordManualAdjustment,recordManualPayout,reconcileCreatorFinance,setCreatorLedgerHold} from './creator-finance.mjs';
import {getOwnerSecrets,readCookie,SESSION_COOKIE_NAME,verifySessionToken} from './owner-auth.mjs';
import {verifyAuthenticatedOwnerMutationRequest} from './owner-mutation-auth.mjs';

export async function handleCreatorFinanceOwnerRequest(request,env={},options={}){
 const db=options.database||env.TRG_ORDERS;
 if(request.method==='GET'){
  const secrets=getOwnerSecrets(env),auth=await verifySessionToken(readCookie(request,SESSION_COOKIE_NAME),secrets.sessionSecret,options.nowMs||Date.now());
  if(!auth.valid)return json({error:'Operator access required.'},403);
  const creatorId=new URL(request.url).searchParams.get('creator');
  return json(creatorId?await getCreatorFinance(db,creatorId,{nowMs:options.nowMs}):await getOperatorFinance(db,{nowMs:options.nowMs}));
 }
 if(request.method!=='POST')return json({error:'Use GET or POST.'},405);
 const auth=await verifyAuthenticatedOwnerMutationRequest(request,env);if(!auth.valid)return json({error:auth.userMessage},auth.status);let body={};try{body=await request.json();}catch{}
 if(body.action==='reconcile')return json({exceptions:await reconcileCreatorFinance(db)});
 try{
  if(body.action==='record_payout')return json({ok:true,...await recordManualPayout(db,{...body,operatorActor:auth.username})});
  if(body.action==='manual_adjustment')return json({ok:true,...await recordManualAdjustment(db,{...body,operatorActor:auth.username})});
  if(body.action==='set_hold')return json({ok:true,...await setCreatorLedgerHold(db,{...body,operatorActor:auth.username})});
  if(body.action==='record_fee_policy')return json({ok:true,...await recordFeePolicy(db,{...body,operatorActor:auth.username})});
  return json({error:'Finance action is invalid.'},400);
 }catch(error){return json({error:error.message},409);}
}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8'}});}
