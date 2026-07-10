import { handleOwnerPricingPublishRequest } from "../../_lib/owner-pricing-publish.mjs";

export function onRequestPost(context) {
  return handleOwnerPricingPublishRequest(context.request, context.env);
}

export function onRequest(context) {
  if (String(context.request.method || "GET").toUpperCase() === "POST") {
    return onRequestPost(context);
  }

  return new Response(JSON.stringify({
    error: "Pricing updates only accept POST requests."
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    status: 405
  });
}
