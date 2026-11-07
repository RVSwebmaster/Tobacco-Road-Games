import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";
import { jsonResponse } from "./owner-runtime.mjs";
import { normalizeStoreState, readStoreState, writeStoreState } from "./store-state.mjs";

export async function handleOwnerStoreStatusGet(request, env) {
  const result = await readStoreState(env);
  return jsonResponse(result.available ? { state: result.state, updatedAt: result.updatedAt, updatedBy: result.updatedBy } : { error: "Store status could not be read. Purchasing is being refused safely.", state: "CLOSED" }, result.available ? 200 : 503);
}

export async function handleOwnerStoreStatusPost(request, env) {
  let session;
  try { session = await getSessionFromRequest(request, env); }
  catch { return jsonResponse({ error: "Owner session could not be verified." }, 503); }
  if (!session.valid) return jsonResponse({ error: "Sign in as an Owner to change store status." }, 401);
  if (!["owner", "admin"].includes(session.user.role)) {
    return jsonResponse({ error: "Only an Owner may change store status." }, 403);
  }
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return jsonResponse({ error: "The Owner status request could not be verified." }, 403);
  }
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: "Store status changes must be valid JSON." }, 400); }
  const state = normalizeStoreState(payload?.state);
  if (!state) return jsonResponse({ error: "Store state must be OPEN, CLOSED, or MAINTENANCE." }, 400);
  try { return jsonResponse(await writeStoreState(env, state, session.user.id), 200); }
  catch { return jsonResponse({ error: "Store status could not be saved. Purchasing remains fail-closed." }, 503); }
}
