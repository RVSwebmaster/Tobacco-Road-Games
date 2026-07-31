import { renderForumHome } from "../_lib/forum-categories.mjs";
export function onRequest({ request, env }) { return renderForumHome(request, env); }
