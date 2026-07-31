import { handleForumAvatarMutation } from "../../../_lib/forum-avatars.mjs";
export function onRequest({ request, env }) { return handleForumAvatarMutation(request, env); }
