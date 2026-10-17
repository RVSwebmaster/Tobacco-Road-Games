import { createAuthorReply, listDiscussions } from "../../_lib/author-discussions.mjs";
import { verifyAuthenticatedOwnerMutationRequest, verifyAuthenticatedOwnerReadRequest } from "../../_lib/owner-mutation-auth.mjs";

export async function onRequestGet({ request, env }) {
  const auth = await verifyAuthenticatedOwnerReadRequest(request, env);
  if (!auth.valid) return Response.json({ error: auth.userMessage }, { status: auth.status });
  return listDiscussions(request, env);
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env);
  if (!auth.valid) return Response.json({ error: auth.userMessage }, { status: auth.status });
  return createAuthorReply(request, env, String(env.DISCUSSION_AUTHOR_DISPLAY_NAME || "RV Sawyer"));
}

