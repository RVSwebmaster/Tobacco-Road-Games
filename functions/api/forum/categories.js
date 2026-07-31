import { handleForumCategoriesApi } from "../../_lib/forum-categories.mjs";
export function onRequest({ request, env }) { return handleForumCategoriesApi(request, env); }
