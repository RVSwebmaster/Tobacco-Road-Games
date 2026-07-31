import { handleCategoryTopicsApi } from "../../../../_lib/forum-topics.mjs";
export function onRequest({ request, env, params }) { return handleCategoryTopicsApi(request, env, params.slug); }
