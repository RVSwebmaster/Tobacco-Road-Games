import { handleFulfillmentRepairRequest } from "../../_lib/fulfillment-repair-route.mjs";

export function onRequestPost(context) {
  return handleFulfillmentRepairRequest(context.request, context.env);
}
