import { getCreatorCapacity } from "./marketplace-policy.mjs";
import { getApprovedPublicProductsByIds } from "./public-product-catalog.mjs";

export async function getCreatorProfileShelfState(database, creatorId, userId, nowMs = Date.now()) {
  await assertProfileOwner(database, creatorId, userId);
  const [productsResult, selectionsResult, catalogCount, shelfCount, capacity] = await Promise.all([
    database.prepare(`SELECT p.id,p.slug,p.title,p.subtitle,p.short_description,p.publication_state,p.status,
        p.buy_mode,p.storefront_visibility,p.cover_r2_key,p.creator_listing_id,p.updated_at,
        cl.lifecycle_state,cl.inactivity_state,cl.owner_review_hold,
        EXISTS(SELECT 1 FROM creator_listing_files f WHERE f.listing_id=cl.id AND f.creator_id=cl.creator_id
          AND f.validation_state<>'superseded'
          AND ((f.purpose='cover' AND f.content_type='image/webp') OR (f.purpose='product' AND f.generated_cover_key IS NOT NULL))) has_creator_cover
      FROM marketplace_products p LEFT JOIN creator_listings cl ON cl.id=p.creator_listing_id
      WHERE p.creator_id=? ORDER BY p.updated_at DESC,p.title,p.id`)
      .bind(String(creatorId)).all(),
    database.prepare("SELECT product_id FROM creator_profile_shelf_selections WHERE creator_id=? ORDER BY position,product_id")
      .bind(String(creatorId)).all(),
    database.prepare("SELECT COUNT(*) count FROM marketplace_products WHERE creator_id=? AND publication_state='published' AND status<>'retired' AND buy_mode<>'retired'")
      .bind(String(creatorId)).first(),
    database.prepare("SELECT COUNT(*) count FROM creator_profile_shelf_selections WHERE creator_id=?")
      .bind(String(creatorId)).first(),
    getCreatorCapacity(database, creatorId, nowMs)
  ]);
  const publicProducts = await getApprovedPublicProductsByIds(database, (productsResult.results || []).map(row => String(row.id)));
  const publiclyPurchasableIds = new Set(publicProducts
    .filter(product => product.storefrontVisibility === "listed" && product.purchaseAvailability !== "unavailable")
    .map(product => product.id));
  const selected = new Set((selectionsResult.results || []).map(row => String(row.product_id)));
  const catalogLimit = capacity.activeListingCap;
  const shelfLimit = capacity.shelfCap;
  const products = (productsResult.results || []).map(row => {
    const isPublic = publiclyPurchasableIds.has(String(row.id)) &&
      row.inactivity_state !== "inactive" &&
      Number(row.owner_review_hold || 0) !== 1;
    const coverImage = row.creator_listing_id && Number(row.has_creator_cover) === 1
      ? `/api/creator/listings/${encodeURIComponent(row.creator_listing_id)}/cover`
      : row.cover_r2_key && row.publication_state === "published"
        ? `/product-assets/${encodeURIComponent(row.slug)}/cover.webp`
        : "";
    return {
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title || "Untitled product"),
      subtitle: String(row.subtitle || ""),
      shortDescription: String(row.short_description || ""),
      publicationState: String(row.publication_state || "draft"),
      status: String(row.status || ""),
      buyMode: String(row.buy_mode || ""),
      storefrontVisibility: String(row.storefront_visibility || "unlisted"),
      lifecycleState: String(row.lifecycle_state || ""),
      inactivityState: String(row.inactivity_state || "active"),
      ownerReviewHold: Number(row.owner_review_hold || 0) === 1,
      public: isPublic,
      coverImage,
      detailUrl: `/store/products/${encodeURIComponent(row.slug)}/`,
      shelved: selected.has(String(row.id))
    };
  });
  return {
    creatorId: String(creatorId),
    products,
    productIds: [...selected],
    catalog: { used: Number(catalogCount?.count || 0), limit: catalogLimit },
    shelf: { used: Number(shelfCount?.count || 0), limit: shelfLimit }
  };
}

export async function saveCreatorProfileShelf(database, creatorId, userId, productIds, nowMs = Date.now()) {
  await assertProfileOwner(database, creatorId, userId);
  if (!Array.isArray(productIds) || productIds.length > 200) throw new Error("Choose valid products for the Profile shelf.");
  const ids = productIds.map(value => String(value || "").trim());
  if (ids.some(id => !id || id.length > 160) || new Set(ids).size !== ids.length) {
    throw new Error("The Profile shelf selection contains an invalid product.");
  }
  const capacity = await getCreatorCapacity(database, creatorId, nowMs);
  if (capacity.shelfCap !== null && ids.length > capacity.shelfCap) {
    throw new Error(`Shelf allowance is ${capacity.shelfCap}. Unshelve a product before adding another.`);
  }
  if (ids.length) {
    const owned = await database.prepare(`SELECT id FROM marketplace_products WHERE creator_id=? AND id IN (${ids.map(() => "?").join(",")})`)
      .bind(String(creatorId), ...ids).all();
    if ((owned.results || []).length !== ids.length) throw new Error("One or more products do not belong to this Creator.");
  }
  const now = new Date(nowMs).toISOString();
  await database.batch([
    database.prepare("DELETE FROM creator_profile_shelf_selections WHERE creator_id=?").bind(String(creatorId)),
    ...ids.map((productId, position) => database.prepare(`INSERT INTO creator_profile_shelf_selections(creator_id,product_id,position,selected_at,updated_at)
        VALUES(?,?,?,?,?)`).bind(String(creatorId), productId, position, now, now))
  ]);
  return getCreatorProfileShelfState(database, creatorId, userId, nowMs);
}

async function assertProfileOwner(database, creatorId, userId) {
  const owner = await database.prepare(`SELECT 1 allowed FROM creator_identity_ownership
    WHERE creator_id=? AND owner_user_id=? AND account_status='active' LIMIT 1`)
    .bind(String(creatorId), String(userId)).first();
  if (!owner) throw new Error("Only the authenticated owner of this Creator Profile may manage its shelf.");
}
