import { getCreatorPlateboardAds, getCreatorPlateboardIntervalSeconds } from "../_lib/creator-plateboard.mjs";

export async function onRequestGet({ env }) {
  const items = await getCreatorPlateboardAds(env.TRG_ORDERS);
  const intervalSeconds = getCreatorPlateboardIntervalSeconds(env.CREATOR_PLATEBOARD_ENTRY_INTERVAL_SECONDS);
  return Response.json({ items, intervalSeconds }, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=30" }
  });
}
