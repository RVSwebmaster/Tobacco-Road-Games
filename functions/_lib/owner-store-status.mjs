import { jsonResponse } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";
import { normalizeStoreState, readStoreState, writeStoreState } from "./store-state.mjs";

export async function handleOwnerStoreStatusGet(request, env) {
  const result = await readStoreState(env);
  return jsonResponse(result.available ? { state: result.state, updatedAt: result.updatedAt, updatedBy: result.updatedBy } : { error: "Store status could not be read. Purchasing is being refused safely.", state: "CLOSED" }, result.available ? 200 : 503);
}

export async function handleOwnerStoreStatusPost(request, env) {
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env, { sameOriginMessage: "Store status changes must come from the Tobacco Road Games owner site." });
  if (!auth.valid) return jsonResponse({ error: auth.userMessage }, auth.status);
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: "Store status changes must be valid JSON." }, 400); }
  const state = normalizeStoreState(payload?.state);
  if (!state) return jsonResponse({ error: "Store state must be OPEN, CLOSED, or MAINTENANCE." }, 400);
  try { return jsonResponse(await writeStoreState(env, state, auth.username), 200); }
  catch { return jsonResponse({ error: "Store status could not be saved. Purchasing remains fail-closed." }, 503); }
}
