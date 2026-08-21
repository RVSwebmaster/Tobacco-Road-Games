import { readStoreState } from "../../_lib/store-state.mjs";
import { isAuthenticatedOwnerRequest } from "../../_lib/owner-public-bypass.mjs";

export async function onRequestGet(context) {
  const result = await readStoreState(context.env);
  const ownerBypass = await isAuthenticatedOwnerRequest(context.request, context.env);
  return new Response(JSON.stringify({
    state: ownerBypass ? "OPEN" : result.state,
    available: ownerBypass || result.available,
    ownerBypass,
    publicState: ownerBypass ? result.state : undefined
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function onRequest(context) {
  if (String(context.request.method || "GET").toUpperCase() === "GET") {
    return onRequestGet(context);
  }
  return new Response(null, { status: 405 });
}
