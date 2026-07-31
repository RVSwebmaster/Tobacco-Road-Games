import { handleHandleAvailability } from "../../_lib/forum-profiles.mjs";
export function onRequest({ request, env }) { return handleHandleAvailability(request, env); }
