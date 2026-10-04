import { handleOwnerListingFiles } from "../../_lib/owner-listing-files.mjs";
export function onRequest(context) { return handleOwnerListingFiles(context.request, context.env); }
