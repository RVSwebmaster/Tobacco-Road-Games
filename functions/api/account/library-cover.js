import { handleAccountLibraryCoverRequest } from "../../_lib/account-library-cover.mjs";

export function onRequestGet(context) {
  return handleAccountLibraryCoverRequest(context.request, context.env);
}

export function onRequestHead(context) {
  return handleAccountLibraryCoverRequest(context.request, context.env);
}
