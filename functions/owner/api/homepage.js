import { handleOwnerHomepagePublishRequest } from "../../_lib/owner-homepage-publish.mjs";

export function onRequest(context) {
  return handleOwnerHomepagePublishRequest(context.request, context.env);
}
