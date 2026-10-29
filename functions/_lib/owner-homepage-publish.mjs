import { PUBLICATION_UNAVAILABLE } from "./publication-unavailable.mjs";
import { jsonResponse, normalizeSlug } from "./owner-runtime.mjs";

export async function handleOwnerHomepagePublishRequest(request, env, options = {}) {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse({ error: "Homepage updates only accept POST requests." }, 405);
  }
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Homepage selections must be valid JSON." }, 400); }
  const featuredSlug = normalizeSlug(body?.featuredSlug);
  const workInProgressSlugs = [...new Set((Array.isArray(body?.workInProgressSlugs) ? body.workInProgressSlugs : [])
    .map(normalizeSlug).filter(Boolean))];
  if (!featuredSlug) return jsonResponse({ error: "Choose one featured title." }, 400);

  return jsonResponse({ error: PUBLICATION_UNAVAILABLE }, 503);
}
