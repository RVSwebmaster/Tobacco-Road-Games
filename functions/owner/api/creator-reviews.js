import { handleCreatorReviewRequest } from "../../_lib/creator-review.mjs";
export function onRequestGet(context){return handleCreatorReviewRequest(context.request,context.env);}
export function onRequestPost(context){return handleCreatorReviewRequest(context.request,context.env);}
