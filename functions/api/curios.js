import { handleShelfCuriosRequest } from "../_lib/shelf-curios.mjs";

export function onRequest(context) {
  return handleShelfCuriosRequest(context.request, context.env);
}
