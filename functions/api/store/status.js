import { readStoreState } from "../../_lib/store-state.mjs";

export async function onRequestGet(context) {
  const result = await readStoreState(context.env);
  return new Response(JSON.stringify({
    state: result.state,
    available: result.available
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
