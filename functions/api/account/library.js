import { handleAccountLibraryRequest } from "../../_lib/account-library.mjs";

export function onRequestGet(context) {
  return handleAccountLibraryRequest(context.request, context.env);
}
