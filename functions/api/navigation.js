import { handleProgressiveNavigationRequest } from "../_lib/progressive-navigation.mjs";

export function onRequest(context) {
  return handleProgressiveNavigationRequest(context.request, context.env);
}
