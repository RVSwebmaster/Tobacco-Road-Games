import { handleOwnerShelfCuriosRequest } from "../../_lib/shelf-curios.mjs";

export function onRequest(context) {
  return handleOwnerShelfCuriosRequest(context.request, context.env);
}
