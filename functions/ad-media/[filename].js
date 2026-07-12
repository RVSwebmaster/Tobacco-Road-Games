export async function onRequestGet({ env, params, request }) {
  const filename = String(params.filename || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,99}\.mp4$/.test(filename)) return new Response("Not found", { status: 404 });
  const object = await env.TRG_PRODUCTS?.get?.(`ads/${filename}`, { range: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-disposition", `inline; filename="${filename}"`);
  if (object.range) {
    const offset = object.range.offset || 0;
    const length = object.range.length || object.size;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
