import { getApprovedPublicProductsByIds } from "./public-product-catalog.mjs";

export async function handlePublicCreatorShelfRequest(request, env) {
  const slug = new URL(request.url).searchParams.get("creatorSlug") || "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) || slug.length > 120) {
    return json({ error: "Creator identity is invalid." }, 400);
  }
  if (!env.TRG_ORDERS?.prepare) return json({ error: "Creator shelf is unavailable." }, 503);
  try {
    const selectionRows = await env.TRG_ORDERS.prepare(`SELECT s.product_id FROM creator_profile_shelf_selections s
      JOIN marketplace_creators c ON c.id=s.creator_id
      JOIN marketplace_products p ON p.id=s.product_id
      LEFT JOIN creator_listings cl ON cl.id=p.creator_listing_id
      WHERE c.slug=? AND c.marketplace_status='approved' AND c.registration_status='active' AND c.closure_state='active'
        AND (cl.id IS NULL OR (cl.owner_review_hold=0 AND cl.inactivity_state<>'inactive'))
      ORDER BY s.position,s.product_id`).bind(slug).all();
    const ids = (selectionRows.results || []).map(row => String(row.product_id));
    const products = await getApprovedPublicProductsByIds(env.TRG_ORDERS, ids);
    const eligible = products.filter(product =>
      product.creatorSlug === slug && product.storefrontVisibility === "listed" &&
      product.purchaseAvailability !== "unavailable"
    );
    return json({ creatorSlug: slug, products: eligible }, 200, "public, max-age=60, s-maxage=60");
  } catch (error) {
    console.error(JSON.stringify({ event: "creator_profile_shelf_read_failed", message: String(error?.message || error) }));
    return json({ error: "Creator shelf could not be read." }, 503);
  }
}

function json(body, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
