import { getHomepageShelves } from "../_lib/homepage-shelves.mjs";

export async function onRequestGet({ env }) {
  try {
    const shelves = await getHomepageShelves(env.TRG_ORDERS);
    if (!shelves || shelves.unavailable === true) return json(shelves || { bestSellers: [], unavailable: true }, 200);
    return json(shelves, 200, "public, max-age=60");
  } catch {
    return json({ bestSellers: [], windowDays: 30, unavailable: true }, 200);
  }
}

function json(body, status, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
