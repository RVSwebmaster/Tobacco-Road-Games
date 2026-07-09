import { handleCheckoutCanceledPage } from "../../../_lib/checkout-pages.mjs";

export function onRequestGet(context) {
  return handleCheckoutCanceledPage(context.request, context.env);
}
