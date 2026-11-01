import { handleOwnerPricingPublishRequest } from "../../_lib/owner-pricing-publish.mjs";

export function onRequestPost(context) {
  return handleOwnerPricingPublishRequest(context.request, context.env);
}

export function onRequestGet(context) {
  return handleOwnerPricingPublishRequest(context.request, context.env);
}

export function onRequest(context) {
  return handleOwnerPricingPublishRequest(context.request, context.env);
}
