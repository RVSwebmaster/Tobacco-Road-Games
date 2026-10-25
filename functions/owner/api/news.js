import { createOwnerAnnouncement, listEditorialNews, listNewsSources, updateNewsSource, updateOwnerNews } from "../../_lib/news-service.mjs";
import { verifyAuthenticatedOwnerMutationRequest, verifyAuthenticatedOwnerReadRequest } from "../../_lib/owner-mutation-auth.mjs";

export async function onRequestGet({ request, env }) {
  const auth = await verifyAuthenticatedOwnerReadRequest(request, env);
  if (!auth.valid) return Response.json({ error: auth.userMessage }, { status: auth.status });
  return Response.json({ sources: await listNewsSources(env.TRG_ORDERS), items: await listEditorialNews(env.TRG_ORDERS) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env);
  if (!auth.valid) return Response.json({ error: auth.userMessage }, { status: auth.status });
  try {
    const body = await request.json();
    if (body.operation === "source") return Response.json({ source: await updateNewsSource(env.TRG_ORDERS, body.id, body.enabled, auth.username) });
    if (body.operation === "update") return Response.json({ item: await updateOwnerNews(env.TRG_ORDERS, body.id, body, auth.username) });
    return Response.json({ item: await createOwnerAnnouncement(env.TRG_ORDERS, { ...body, actorId: auth.username }) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message || "News operation failed." }, { status: 400 });
  }
}
