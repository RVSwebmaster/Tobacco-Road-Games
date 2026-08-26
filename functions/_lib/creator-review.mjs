import { SESSION_COOKIE_NAME, getOwnerSecrets, jsonResponse, readCookie, verifySessionToken } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";

export async function handleCreatorReviewRequest(request, env = {}, options = {}) {
  const database=options.database||env.TRG_ORDERS;
  let actor="operator";
  if(request.method==="GET"){
    const secrets=getOwnerSecrets(env), verified=await verifySessionToken(readCookie(request,SESSION_COOKIE_NAME),secrets.sessionSecret,options.nowMs||Date.now());
    if(!verified.valid)return jsonResponse({error:"Operator access required."},403); actor=verified.username;
    const result=await database.prepare(`SELECT cl.id,cl.slug,cl.title,cl.lifecycle_state,cl.publication_state,cl.publication_errors_json,cl.public_product_slug,cl.listed_price_cents,cl.media_type,cl.review_note,cl.submitted_at,c.display_name creator_name,c.slug creator_slug,(SELECT COUNT(*) FROM creator_listing_files f WHERE f.listing_id=cl.id AND f.validation_state='accepted') accepted_files,(SELECT COUNT(*) FROM creator_listing_files f WHERE f.listing_id=cl.id AND f.validation_state='rejected') rejected_files FROM creator_listings cl JOIN marketplace_creators c ON c.id=cl.creator_id WHERE cl.lifecycle_state IN ('submitted','active','needs_changes','rejected') OR cl.publication_state IN ('approved','waiting_for_files','ready','failed') ORDER BY cl.submitted_at`).all();
    const files=await database.prepare("SELECT id,listing_id,purpose,normalized_filename,content_type,size_bytes,validation_state,validation_message,uploaded_at,validated_at FROM creator_listing_files WHERE validation_state<>'superseded' ORDER BY uploaded_at DESC").all();
    return jsonResponse({listings:result.results||[],files:files.results||[]});
  }
  if(request.method!=="POST")return jsonResponse({error:"Use GET or POST."},405);
  const auth=await verifyAuthenticatedOwnerMutationRequest(request,env);if(!auth.valid)return jsonResponse({error:auth.userMessage},auth.status);actor=auth.username;
  let body={};try{body=await request.json();}catch{}
  const action=String(body.action||""), next={approve:"active",request_changes:"needs_changes",reject:"rejected"}[action];if(!next)return jsonResponse({error:"Review action is invalid."},400);
  const listing=await database.prepare("SELECT id,creator_id,lifecycle_state FROM creator_listings WHERE id=?").bind(String(body.listingId||"")).first();if(!listing||listing.lifecycle_state!=="submitted")return jsonResponse({error:"Submitted listing not found."},404);
  const now=new Date(Number.isFinite(options.nowMs)?options.nowMs:Date.now()).toISOString(),note=String(body.note||"").trim().slice(0,2000);
  await database.batch([database.prepare("UPDATE creator_listings SET lifecycle_state=?,publication_state=CASE WHEN ?='approve' THEN 'approved' ELSE 'not_approved' END,reviewed_at=?,review_note=?,updated_at=? WHERE id=? AND lifecycle_state='submitted'").bind(next,action,now,note,now,listing.id),database.prepare("INSERT INTO creator_review_audit(listing_id,creator_id,action,note,created_at) VALUES(?,?,?,?,?)").bind(listing.id,listing.creator_id,action,note,now),database.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'operator',?,?,?,?)").bind(listing.id,listing.creator_id,actor,action,JSON.stringify({note}),now)]);
  return jsonResponse({ok:true,state:next,reviewedBy:actor});
}
