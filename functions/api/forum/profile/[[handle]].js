import { handleForumProfileCollection, handleForumProfilePath } from "../../../_lib/forum-profiles.mjs";

export function onRequest({ request, env, params }) {
  return params.handle
    ? handleForumProfilePath(request, env, params.handle)
    : handleForumProfileCollection(request, env);
}
