import { renderForumCategory } from "../../_lib/forum-categories.mjs";
export function onRequest({ request, env, params }) { return renderForumCategory(request, env, params.slug); }
