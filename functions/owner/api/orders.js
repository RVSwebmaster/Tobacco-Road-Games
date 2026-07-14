import { handleOwnerOrdersRequest } from "../../_lib/owner-orders.mjs";

export function onRequest(context) {
  return handleOwnerOrdersRequest(context.request, context.env);
}
