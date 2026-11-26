import { handlePublicCreatorShelfRequest } from "../../_lib/creator-profile-public-shelf.mjs";

export function onRequestGet({ request, env }) {
  return handlePublicCreatorShelfRequest(request, env);
}
