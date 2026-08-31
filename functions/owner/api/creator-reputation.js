import { SESSION_COOKIE_NAME, getOwnerSecrets, jsonResponse, readCookie, verifySessionToken } from "../../_lib/owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "../../_lib/owner-mutation-auth.mjs";
import { getLaunchEvent, previewFoundingCreators, awardFoundingCreator, manageBadgeAward, moderateCreatorRating } from "../../_lib/creator-reputation.mjs";

export async function onRequestGet({ request, env }) {
  const auth = await ownerRead(request, env); if (!auth.valid) return jsonResponse({ error: "Operator access required." }, 403);
  const db = env.TRG_ORDERS, event = await getLaunchEvent(db), founding = await previewFoundingCreators(db);
  const badges = await db.prepare("SELECT * FROM creator_badge_definitions ORDER BY category,display_priority,title").all();
  const awards = await db.prepare("SELECT a.*,d.title,d.category,c.display_name creator_name FROM creator_badge_awards a JOIN creator_badge_definitions d ON d.id=a.badge_id JOIN marketplace_creators c ON c.id=a.creator_id ORDER BY a.awarded_at DESC LIMIT 200").all();
  const ratings = await db.prepare("SELECT r.id,r.creator_id,r.rating_value,r.moderation_state,r.fraud_state,r.created_at,c.display_name creator_name FROM creator_reputation_ratings r JOIN marketplace_creators c ON c.id=r.creator_id WHERE r.moderation_state<>'visible' OR r.fraud_state<>'clear' ORDER BY r.updated_at DESC LIMIT 200").all();
  return jsonResponse({ event, founding, badges: badges.results || [], awards: awards.results || [], ratings: ratings.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env); if (!auth.valid) return jsonResponse({ error: auth.userMessage }, auth.status);
  let body={}; try { body=await request.json(); } catch {}
  const db=env.TRG_ORDERS, now=new Date().toISOString();
  try {
    if (body.action === "configure_event") {
      const state=String(body.state||""); if (!['prelaunch','live','archive'].includes(state)) throw new Error("Event state is invalid.");
      for (const key of ['startsAt','endsAt','foundingWindowStart','foundingWindowEnd']) if (body[key] && !Number.isFinite(Date.parse(body[key]))) throw new Error(`${key} must be an ISO date.`);
      const current=await getLaunchEvent(db), content={...current.content,...(body.content||{})};
      await db.batch([db.prepare("UPDATE marketplace_events SET lifecycle_state=?,starts_at=?,ends_at=?,founding_window_start=?,founding_window_end=?,content_json=?,is_public=?,updated_at=? WHERE id='official-launch-week'").bind(state,body.startsAt||null,body.endsAt||null,body.foundingWindowStart||null,body.foundingWindowEnd||null,JSON.stringify(content),body.public===true?1:0,now),db.prepare("INSERT INTO creator_reputation_audit(actor_type,actor_id,action,subject_type,subject_id,context_json,created_at) VALUES('operator',?,'configure','event','official-launch-week',?,?)").bind(auth.username,JSON.stringify({state,public:body.public===true}),now)]);
      return jsonResponse({ok:true});
    }
    if (body.action === "award_founding") return jsonResponse({ok:true,...await awardFoundingCreator(db,{creatorId:String(body.creatorId||""),actorId:auth.username})});
    if (["award_badge","revoke_badge","correct_badge","restore_badge"].includes(body.action)) return jsonResponse({ok:true,...await manageBadgeAward(db,{action:{award_badge:"award",revoke_badge:"revoke",correct_badge:"correct",restore_badge:"restore"}[body.action],awardId:body.awardId,creatorId:body.creatorId,badgeId:body.badgeId,source:body.source,sourceNotes:body.sourceNotes,awardedAt:body.awardedAt,expiresAt:body.expiresAt,reason:body.reason,actorId:auth.username})});
    if (body.action === "moderate_rating") return jsonResponse({ok:true,...await moderateCreatorRating(db,{ratingId:String(body.ratingId||""),action:String(body.moderationAction||""),reason:body.reason,actorId:auth.username})});
    throw new Error("Operator action is invalid.");
  } catch(error) { return jsonResponse({error:error.message},409); }
}
async function ownerRead(request,env){const secrets=getOwnerSecrets(env),verified=await verifySessionToken(readCookie(request,SESSION_COOKIE_NAME),secrets.sessionSecret,Date.now());return verified;}
