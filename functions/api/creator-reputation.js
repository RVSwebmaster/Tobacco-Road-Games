import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "../_lib/account-auth.mjs";
import { getLaunchEvent, listCreatorBadges, getCreatorRatingSummary, getCustomerRatingState, submitCreatorRating } from "../_lib/creator-reputation.mjs";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), db = env.TRG_ORDERS;
  if (url.searchParams.get("event")) {
    const event = await getLaunchEvent(db);
    if (!event?.public) return json({ event: null, state: "not_announced" });
    return json({ event });
  }
  const creator = await db.prepare("SELECT id,slug,display_name FROM marketplace_creators WHERE (id=? OR slug=?) AND marketplace_status='approved'").bind(url.searchParams.get("creator") || "", url.searchParams.get("creator") || "").first();
  if (!creator) return json({ error: { message: "Creator not found." } }, 404);
  const threshold = Number(env.CREATOR_RATING_PUBLIC_THRESHOLD || 5);
  const customerRequested = url.searchParams.get("customer") === "1";
  let customer = null;
  if (customerRequested) {
    const session = await getSessionFromRequest(request, env);
    if (session.valid) { const state=await getCustomerRatingState(db,{creatorId:creator.id,userId:session.user.id});customer={eligible:state.eligible,emailVerified:state.emailVerified,currentRating:state.currentRating}; }
    else customer={eligible:false,emailVerified:false,currentRating:null,authenticationRequired:true};
  }
  return json({ creator: { id: creator.id, slug: creator.slug, displayName: creator.display_name }, badges: await listCreatorBadges(db, creator.id), rating: await getCreatorRatingSummary(db, creator.id, { threshold }), ...(customerRequested ? {customer} : {}) }, 200, { "cache-control": customerRequested ? "private, no-store" : "public, max-age=60" });
}

export async function onRequestPost({ request, env }) {
  const session = await getSessionFromRequest(request, env);
  if (!session.valid) return json({ error: { message: "Sign in to rate a Creator." } }, 401);
  if (Number(session.user.email_verified) !== 1) return json({ error: { message: "Verify your account email before rating a Creator." } }, 403);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) return json({ error: { message: "The rating request could not be verified." } }, 403);
  let body = {}; try { body = await request.json(); } catch {}
  try { return json({ ok: true, rating: await submitCreatorRating(env.TRG_ORDERS, { creatorId: String(body.creatorId || ""), userId: session.user.id, ratingValue: body.ratingValue, feedback: body.feedback }) }, 201); }
  catch (error) { return json({ error: { message: error.message } }, 409); }
}
function json(payload, status=200, headers={}) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } }); }
