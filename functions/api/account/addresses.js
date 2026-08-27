import { handleAccountAddressesRequest } from "../../_lib/account-addresses.mjs";

export function onRequest(context) {
  return handleAccountAddressesRequest(context.request, context.env);
}
