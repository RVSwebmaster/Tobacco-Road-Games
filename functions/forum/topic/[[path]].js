import { renderForumTopic } from "../../_lib/forum-topics.mjs";
export function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  return renderForumTopic(request, env, parts[0], parts[1] || "");
}
