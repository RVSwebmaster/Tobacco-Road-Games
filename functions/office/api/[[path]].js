import { handleOfficeApiRequest } from "../../_lib/office-api.mjs";

export function onRequest(context) {
  return handleOfficeApiRequest(context.request, context.env);
}

