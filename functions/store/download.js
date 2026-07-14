import { handleAuthorizedDownload } from "../_lib/download-route.mjs";

export function onRequestGet(context) {
  return handleAuthorizedDownload(context.request, context.env);
}
