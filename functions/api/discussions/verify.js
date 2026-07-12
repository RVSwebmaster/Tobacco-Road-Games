import { verifyDiscussion } from "../../_lib/author-discussions.mjs";
export function onRequestGet({ request, env }) { return verifyDiscussion(request, env); }
