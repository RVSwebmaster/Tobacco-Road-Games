import { createDiscussionComment, listDiscussions } from "../_lib/author-discussions.mjs";
export function onRequestGet({ request, env }) { return listDiscussions(request, env); }
export function onRequestPost({ request, env }) { return createDiscussionComment(request, env); }

