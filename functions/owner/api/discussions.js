import { createAuthorReply, listDiscussions } from "../../_lib/author-discussions.mjs";

export function onRequestGet({ request, env }) {
  return listDiscussions(request, env);
}

export async function onRequestPost({ request, env }) {
  return createAuthorReply(request, env, String(env.DISCUSSION_AUTHOR_DISPLAY_NAME || "RV Sawyer"));
}

