import { getHomepageShelves } from "../_lib/homepage-shelves.mjs";

export async function onRequestGet({ env }) {
  try {
    const shelves = await getHomepageShelves(env.TRG_ORDERS);
    return json(shelves, 200);
  } catch {
    return json({ bestSellers: [], windowDays: 30, unavailable: true }, 200);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
