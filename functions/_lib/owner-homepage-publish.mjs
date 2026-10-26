import { dispatchPublishWorkflow } from "./github-dispatch.mjs";
import { OWNER_ACTOR_ID, jsonResponse, normalizeSlug } from "./owner-runtime.mjs";

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

  const dispatchResult = await dispatchPublishWorkflow({
    featuredSlug,
    operation: "homepage_update",
    publish_id: `homepage-${Date.now()}-${crypto.randomUUID()}`,
    ref: String(env.GITHUB_PUBLISH_REF || "main"),
    requested_by: OWNER_ACTOR_ID,
    workInProgressSlugs
  }, env, options.dispatchOptions);
  if (!dispatchResult.ok) return jsonResponse({ error: `The homepage selections could not be published. ${dispatchResult.userMessage}`, runUrl: dispatchResult.runUrl || "" }, 502);
  return jsonResponse({
    featuredSlug,
    message: dispatchResult.pending ? "Homepage update accepted. The live site may take another minute to update." : "Homepage selections published successfully.",
    ok: true,
    pending: Boolean(dispatchResult.pending),
    runUrl: dispatchResult.runUrl || "",
    workInProgressSlugs
  }, dispatchResult.pending ? 202 : 200);
}
