import { handleCheckoutCompletePage } from "../../_lib/checkout-pages.mjs";

export function onRequestGet(context) {
  return handleCheckoutCompletePage(context.request, context.env);
}
