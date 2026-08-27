import { handleCreatorRequest } from "../../_lib/creator-operations.mjs";

export function onRequest(context) {
  return handleCreatorRequest(context.request, context.env);
}
