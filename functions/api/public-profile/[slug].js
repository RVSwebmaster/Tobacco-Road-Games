import { handlePublicCreatorProfileRequest } from "../../_lib/owner-profile.mjs";

export function onRequestGet(context) {
  return handlePublicCreatorProfileRequest(context.request, context.env, { slug: context.params.slug });
}

export function onRequest(context) {
  return onRequestGet(context);
}
