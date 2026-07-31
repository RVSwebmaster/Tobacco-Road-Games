import { handleAccountMeRequest } from "../../_lib/account-auth.mjs";

export function onRequest(context) {
  return handleAccountMeRequest(context.request, context.env);
}
