import { handleOwnerProfileRequest } from "../../_lib/owner-profile.mjs";

export function onRequest(context) {
  return handleOwnerProfileRequest(context.request, context.env);
}
