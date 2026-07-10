import { handlePublishProofRequest } from "../../_lib/publish-proof.mjs";

export function onRequestPost(context) {
  return handlePublishProofRequest(context.request, context.env);
}

export function onRequest(context) {
  if (String(context.request.method || "GET").toUpperCase() === "POST") {
    return onRequestPost(context);
  }

  return new Response(JSON.stringify({
    error: "Publish proof only accepts POST requests."
  }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status: 405
  });
}
