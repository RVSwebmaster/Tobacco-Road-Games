import { handleResendWebhookRequest } from "../../_lib/resend-webhook.mjs";

export function onRequestPost(context) {
  return handleResendWebhookRequest(context.request, context.env);
}

export function onRequest() {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 405
  });
}
