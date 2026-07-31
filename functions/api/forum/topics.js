import { handleForumTopicsCollection } from "../../_lib/forum-topics.mjs";
export function onRequest({ request, env }) { return handleForumTopicsCollection(request, env); }
