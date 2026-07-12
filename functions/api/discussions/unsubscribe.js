import { unsubscribeDiscussion } from "../../_lib/author-discussions.mjs";
export function onRequestGet({ request, env }) { return unsubscribeDiscussion(request, env); }
