export async function getCreatorPlateboardAds(database) {
  const result = await database.prepare(`
    WITH eligible AS (
      SELECT
        c.creator_id creatorId,
        m.display_name creatorName,
        c.id adKey,
        c.alt_text altText,
        '/creator-ad-media/' || c.id creativeUrl,
        CASE
          WHEN l.lifecycle_state = 'active'
            AND l.publication_state = 'published'
            AND COALESCE(l.inactivity_state, 'active') <> 'inactive'
            AND COALESCE(l.owner_review_hold, 0) = 0
            AND COALESCE(NULLIF(l.public_product_slug, ''), NULLIF(l.source_product_slug, '')) IS NOT NULL
          THEN '/store/products/' || COALESCE(NULLIF(l.public_product_slug, ''), NULLIF(l.source_product_slug, '')) || '/'
          ELSE NULL
        END destinationUrl,
        COALESCE(NULLIF(l.title, ''), 'Creator advertisement') title,
        ROW_NUMBER() OVER (
          PARTITION BY c.creator_id
          ORDER BY COALESCE(c.validated_at, c.created_at) DESC, c.id
        ) creatorCreativeRank
      FROM creator_ad_creatives c
      JOIN marketplace_creators m ON m.id = c.creator_id
      LEFT JOIN creator_listings l ON l.id = c.listing_id AND l.creator_id = c.creator_id
      WHERE m.marketplace_status = 'approved'
        AND c.validation_state = 'accepted'
        AND c.public_object_key IS NOT NULL
    )
    SELECT creatorId, creatorName, adKey, altText, creativeUrl, destinationUrl, title
    FROM eligible
    WHERE creatorCreativeRank = 1
    ORDER BY creatorId
  `).all();
  return result.results || [];
}

export function getCreatorPlateboardIntervalSeconds(value) {
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1 && interval <= 3600 ? interval : 60;
}
