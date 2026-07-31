import { handleAccountAuthRequest } from "../../_lib/account-auth.mjs";

export function onRequest(context) {
  return handleAccountAuthRequest(context.request, context.env);
}
