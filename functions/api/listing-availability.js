export async function onRequestGet(context) {
  const raw = String(new URL(context.request.url).searchParams.get("slugs") || "");
  const slugs = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  if (!context.env?.TRG_ORDERS || !slugs.length) return json({ unavailable: [] });
  const unavailable = [];
  for (const slug of slugs) {
    const listing = await context.env.TRG_ORDERS.prepare("SELECT 1 FROM creator_listings WHERE (source_product_slug=? OR public_product_slug=?) AND owner_review_hold=1 LIMIT 1").bind(slug, slug).first();
    const bundle = await context.env.TRG_ORDERS.prepare("SELECT 1 FROM creator_bundles b JOIN creator_bundle_items bi ON bi.bundle_id=b.id JOIN creator_listings l ON l.id=bi.listing_id WHERE b.public_bundle_slug=? AND l.owner_review_hold=1 LIMIT 1").bind(slug).first();
    if (listing || bundle) unavailable.push(slug);
  }
  return json({ unavailable });
}

function json(payload) { return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
