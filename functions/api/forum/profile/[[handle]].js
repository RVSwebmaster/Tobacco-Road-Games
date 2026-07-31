import { handleForumProfilePath } from "../../../_lib/forum-profiles.mjs";
export function onRequest({ request, env, params }) { return handleForumProfilePath(request, env, params.handle); }
