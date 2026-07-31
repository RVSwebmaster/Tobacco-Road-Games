import { handleForumProfileCollection } from "../../_lib/forum-profiles.mjs";
export function onRequest({ request, env }) { return handleForumProfileCollection(request, env); }
