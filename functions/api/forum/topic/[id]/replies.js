import { handleForumReplyCreation } from "../../../../_lib/forum-topics.mjs";
export function onRequest({ request, env, params }) { return handleForumReplyCreation(request, env, params.id); }
