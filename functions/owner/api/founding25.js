import { handleFounding25OwnerRequest } from "../../_lib/founding25-owner.mjs";
export function onRequestGet(context) { return handleFounding25OwnerRequest(context.request, context.env); }
export function onRequestPost(context) { return handleFounding25OwnerRequest(context.request, context.env); }
