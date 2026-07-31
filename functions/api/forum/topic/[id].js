import { handleTopicApi } from "../../../_lib/forum-topics.mjs";
export function onRequest({ request, env, params }) { return handleTopicApi(request, env, params.id); }
