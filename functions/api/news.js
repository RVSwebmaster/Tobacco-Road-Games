import { listPublicNews } from "../_lib/news-service.mjs";

export async function onRequestGet({ env }) {
  if (!env.TRG_ORDERS) return Response.json({ items: [] }, { headers: { "cache-control": "public, max-age=60" } });
  try {
    const items = await listPublicNews(env.TRG_ORDERS);
    return Response.json({ items }, { headers: { "cache-control": "public, max-age=60, s-maxage=120" } });
  } catch {
    return Response.json({ items: [], degraded: true }, { headers: { "cache-control": "no-store" } });
  }
}
