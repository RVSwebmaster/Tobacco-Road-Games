import { handleModerationAction } from "../../../_lib/forum-moderation.mjs";
export function onRequest({ request, env }) { return handleModerationAction(request, env); }
