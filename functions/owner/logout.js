import { handleOwnerLogoutRequest } from "../_lib/owner-login.mjs";

export function onRequest(context) {
  return handleOwnerLogoutRequest(context.request);
}
