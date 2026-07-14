import { handleOrderAccessPage } from "../_lib/order-access-page.mjs";

export function onRequestGet(context) {
  return handleOrderAccessPage(context.request, context.env);
}

export function onRequest() {
  return new Response("Method Not Allowed", { status: 405 });
}
