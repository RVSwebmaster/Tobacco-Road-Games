import { handleForumReport } from "../../../../_lib/forum-moderation.mjs";
export function onRequest({ request, env, params }) { return handleForumReport(request, env, "topic", params.id); }
