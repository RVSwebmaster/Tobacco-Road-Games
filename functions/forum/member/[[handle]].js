import { renderPublicProfilePage } from "../../_lib/forum-profiles.mjs";
export function onRequestGet({ request, env, params }) { return renderPublicProfilePage(request, env, params.handle); }
