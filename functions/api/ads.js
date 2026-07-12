export async function onRequestGet({ env }) {
  if (!env.TRG_PRODUCTS?.list) return Response.json({ videos: [] });
  const result = await env.TRG_PRODUCTS.list({ prefix: "ads/", limit: 1000 });
  const videos = result.objects.map((object) => ({
    file: object.key.slice(4),
    size: object.size,
    uploaded: object.uploaded
  })).filter((video) => video.file.endsWith(".mp4"));
  return Response.json({ videos }, { headers: { "cache-control": "public, max-age=60" } });
}
