import { deliverForumAvatar } from "../../_lib/forum-avatars.mjs";
export function onRequest({ request, env, params }) { return deliverForumAvatar(request, env, params.handle); }
