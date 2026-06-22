import { handleOwnerLoginRequest } from "../_lib/owner-login.mjs";

export function onRequest(context) {
  return handleOwnerLoginRequest(context.request, context.env);
}
