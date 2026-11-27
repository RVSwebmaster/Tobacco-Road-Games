import { getApprovedPublicProductsByIds, publicProduct } from "./public-product-catalog.mjs";
import { listProducts } from "./product-catalog-d1.mjs";

export async function handlePublicCreatorShelfRequest(request, env) {
  const slug = new URL(request.url).searchParams.get("creatorSlug") || "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) || slug.length > 120) {
    return json({ error: "Creator identity is invalid." }, 400);
  }
  if (!env.TRG_ORDERS?.prepare) return json({ error: "Creator shelf is unavailable." }, 503);
  try {
    const creator = await env.TRG_ORDERS.prepare(`SELECT id,slug,display_name,logo,profile_image,short_bio,long_bio
      FROM marketplace_creators WHERE slug=? AND marketplace_status='approved'
        AND registration_status='active' AND closure_state='active'`).bind(slug).first();
    if (!creator) return json({ error: "Creator profile not found." }, 404);
    const selectionRows = await env.TRG_ORDERS.prepare(`SELECT s.product_id FROM creator_profile_shelf_selections s
      JOIN marketplace_creators c ON c.id=s.creator_id
      JOIN marketplace_products p ON p.id=s.product_id
      LEFT JOIN creator_listings cl ON cl.id=p.creator_listing_id
      WHERE c.slug=? AND c.marketplace_status='approved' AND c.registration_status='active' AND c.closure_state='active'
        AND (cl.id IS NULL OR (cl.owner_review_hold=0 AND cl.inactivity_state<>'inactive'))
      ORDER BY s.position,s.product_id`).bind(slug).all();
    const ids = (selectionRows.results || []).map(row => String(row.product_id));
    const selectedProducts = await getApprovedPublicProductsByIds(env.TRG_ORDERS, ids);
    const eligibleShelf = selectedProducts.filter(product =>
      product.creatorSlug === slug && product.storefrontVisibility === "listed" &&
      product.purchaseAvailability !== "unavailable"
    );
    const shelfIds = new Set(eligibleShelf.map(product => product.id));
    const publicRows = await listProducts(env.TRG_ORDERS, {
      creatorId: String(creator.id), publicationState: "published", limit: 200
    });
    const eligibleListings = await env.TRG_ORDERS.prepare(`SELECT id FROM creator_listings
      WHERE creator_id=? AND lifecycle_state='active' AND publication_state='published'
        AND inactivity_state<>'inactive' AND owner_review_hold=0`).bind(String(creator.id)).all();
    const eligibleListingIds = new Set((eligibleListings.results || []).map(row => String(row.id)));
    const catalog = publicRows
      .filter(product => !product.creatorListingId || eligibleListingIds.has(product.creatorListingId))
      .map(product => publicProduct(product, creator))
      .filter(product => product.creatorSlug === slug && product.storefrontVisibility === "listed" &&
        product.purchaseAvailability !== "unavailable")
      .map(product => ({ ...product, shelved: shelfIds.has(product.id) }));
    return json({
      creatorSlug: slug,
      creator: {
        slug,
        name: String(creator.display_name || "Creator"),
        logo: String(creator.logo || ""),
        profileImage: String(creator.profile_image || ""),
        shortBio: String(creator.short_bio || ""),
        longBio: String(creator.long_bio || ""),
        personalMessage: ""
      },
      products: eligibleShelf,
      catalog
    }, 200, "public, max-age=60, s-maxage=60");
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
