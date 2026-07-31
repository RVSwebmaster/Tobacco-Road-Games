import { renderPublicProfilePage } from "../../_lib/forum-profiles.mjs";
export function onRequestGet({ request, env, params }) {
  const handle = Array.isArray(params.handle) ? params.handle.join("/") : params.handle;
  return renderPublicProfilePage(request, env, handle);
}
