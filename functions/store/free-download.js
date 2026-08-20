export { handleFreeDownloadRequest } from "../_lib/free-download.mjs";
import { handleFreeDownloadRequest } from "../_lib/free-download.mjs";
export function onRequestGet(context) { return handleFreeDownloadRequest(context.request, context.env); }
