import { handleOwnerPublishRequest } from "../../_lib/owner-publish.mjs";

export function onRequestPost(context) {
  return handleOwnerPublishRequest(context.request, context.env);
}

export function onRequest(context) {
  if (context.request.method.toUpperCase() === "POST") {
    return onRequestPost(context);
  }

  return new Response(JSON.stringify({
    error: "Publish only accepts POST requests."
  }), {
    status: 405,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
