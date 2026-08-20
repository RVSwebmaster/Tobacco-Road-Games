export { handleFreeDownloadFileRequest } from "../_lib/free-download.mjs";
import { handleFreeDownloadFileRequest } from "../_lib/free-download.mjs";
export function onRequestGet(context) { return handleFreeDownloadFileRequest(context.request, context.env); }
