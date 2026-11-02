import { getSessionFromRequest } from "./account-auth.mjs";

export async function handleCreatorCatalogCover(request, env = {}, listingId, options = {}) {
  if (request.method !== "GET") return response("Use GET.", 405);
  const database = options.database || env.TRG_ORDERS;
  const bucket = options.bucket || env.TRG_PRODUCTS;
  if (!database?.prepare || !bucket?.get) return response("Creator cover unavailable.", 503);
  let session;
  try {
    session = await getSessionFromRequest(request, { ...env, TRG_ORDERS: database }, options.sessionOptions || options);
  } catch {
    return response("Creator session unavailable.", 503);
  }
  if (!session.valid) return response("Not found.", 404);
  const file = await database.prepare(`SELECT f.quarantine_key,f.content_type
    FROM creator_listing_files f
    JOIN creator_listings l ON l.id=f.listing_id AND l.creator_id=f.creator_id
    JOIN creator_memberships m ON m.creator_id=l.creator_id AND m.user_id=?
    WHERE l.id=? AND f.purpose='cover' AND f.content_type='image/webp'
      AND f.validation_state<>'superseded'
    ORDER BY f.uploaded_at DESC LIMIT 1`).bind(session.user.id, String(listingId || "")).first();
  if (!file) return response("Not found.", 404);
  let object;
  try { object = await bucket.get(file.quarantine_key); }
  catch { return response("Creator cover unavailable.", 503); }
  if (!object?.body) return response("Not found.", 404);
  return new Response(object.body, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
    },
  });
}

function response(message, status) {
  return new Response(message, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}
