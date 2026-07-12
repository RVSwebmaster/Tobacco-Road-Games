import { handleOwnerAdUpload } from "../../_lib/owner-ad-upload.mjs";

export function onRequestPost(context) {
  return handleOwnerAdUpload(context.request, context.env);
}
