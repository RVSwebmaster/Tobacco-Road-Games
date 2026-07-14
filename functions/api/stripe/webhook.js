import { handleStripeWebhookRequest } from "../../_lib/stripe-webhook.mjs";

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed", {
      headers: { allow: "POST" },
      status: 405
    });
  }
  return handleStripeWebhookRequest(context.request, context.env);
}
