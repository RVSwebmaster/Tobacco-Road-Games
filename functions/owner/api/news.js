import { createOwnerAnnouncement, listEditorialNews, listNewsSources, updateNewsSource, updateOwnerNews } from "../../_lib/news-service.mjs";
import { OWNER_ACTOR_ID } from "../../_lib/owner-runtime.mjs";

export async function onRequestGet({ request, env }) {
  return Response.json({ sources: await listNewsSources(env.TRG_ORDERS), items: await listEditorialNews(env.TRG_ORDERS) });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (body.operation === "source") return Response.json({ source: await updateNewsSource(env.TRG_ORDERS, body.id, body.enabled, OWNER_ACTOR_ID) });
    if (body.operation === "update") return Response.json({ item: await updateOwnerNews(env.TRG_ORDERS, body.id, body, OWNER_ACTOR_ID) });
    return Response.json({ item: await createOwnerAnnouncement(env.TRG_ORDERS, { ...body, actorId: OWNER_ACTOR_ID }) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message || "News operation failed." }, { status: 400 });
  }
}
