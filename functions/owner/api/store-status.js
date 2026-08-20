import { handleOwnerStoreStatusGet, handleOwnerStoreStatusPost } from "../../_lib/owner-store-status.mjs";

export async function onRequestGet(context) {
  return handleOwnerStoreStatusGet(context.request, context.env);
}

export async function onRequestPost(context) {
  return handleOwnerStoreStatusPost(context.request, context.env);
}

export function onRequest(context) {
  return String(context.request.method || "GET").toUpperCase() === "POST"
    ? onRequestPost(context)
    : onRequestGet(context);
}
