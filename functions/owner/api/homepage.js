import { handleOwnerHomepagePublishRequest } from "../../_lib/owner-homepage-publish.mjs";

export function onRequest(context) {
  return handleOwnerHomepagePublishRequest(context.request, context.env);
}

export function onRequestGet(context) {
  return handleOwnerHomepagePublishRequest(context.request, context.env);
}

export function onRequestPost(context) {
  return handleOwnerHomepagePublishRequest(context.request, context.env);
}
