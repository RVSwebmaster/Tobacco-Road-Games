import { handleAccountOrderClaimRequest } from "../../_lib/account-order-claim.mjs";

export function onRequestPost(context) {
  return handleAccountOrderClaimRequest(context.request, context.env);
}
