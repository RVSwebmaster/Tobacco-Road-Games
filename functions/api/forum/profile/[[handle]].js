import { handleForumProfileCollection, handleForumProfilePath } from "../../../_lib/forum-profiles.mjs";

export function onRequest({ request, env, params }) {
  const handle = Array.isArray(params.handle) ? params.handle.join("/") : params.handle;
  return handle
    ? handleForumProfilePath(request, env, handle)
    : handleForumProfileCollection(request, env);
}
