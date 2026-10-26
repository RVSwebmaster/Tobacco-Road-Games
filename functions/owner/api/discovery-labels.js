import { listOperatorDiscovery, recalculateDiscoveryLabels, setDiscoverySuppression } from "../../_lib/marketplace-discovery-labels.mjs";
import { OWNER_ACTOR_ID, jsonResponse } from "../../_lib/owner-runtime.mjs";

export async function onRequestGet({ env }) {
  return jsonResponse(await listOperatorDiscovery(env.TRG_ORDERS));
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    if (body.action === "recalculate") return jsonResponse({ ok: true, ...await recalculateDiscoveryLabels(env.TRG_ORDERS, { env, actorType: "operator", actorId: OWNER_ACTOR_ID, runKey: body.runKey }) });
    if (["remove", "restore"].includes(body.action)) return jsonResponse({ ok: true, ...await setDiscoverySuppression(env.TRG_ORDERS, { subjectType: body.subjectType, subjectId: body.subjectId, label: body.label, action: body.action, reasonCode: body.reasonCode, reasonNotes: body.reasonNotes, actorId: OWNER_ACTOR_ID }) });
    throw new Error("Discovery action is invalid.");
  } catch (error) {
    return jsonResponse({ error: error.message }, 409);
  }
}
