import { renderModerationPage } from "../_lib/forum-moderation.mjs";
export function onRequest({ request, env }) { return renderModerationPage(request, env); }
