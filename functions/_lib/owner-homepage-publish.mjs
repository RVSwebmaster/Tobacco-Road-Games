import { dispatchPublishWorkflow } from "./github-dispatch.mjs";
import { jsonResponse, normalizeSlug } from "./owner-auth.mjs";
import { verifyAuthenticatedOwnerMutationRequest } from "./owner-mutation-auth.mjs";

export async function handleOwnerHomepagePublishRequest(request, env, options = {}) {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse({ error: "Homepage updates only accept POST requests." }, 405);
  }
  const authState = await verifyAuthenticatedOwnerMutationRequest(request, env, {
    csrfExpiredMessage: "The homepage editor security token has expired. Reload the page and try again.",
    csrfMismatchMessage: "The homepage editor security token did not match. Reload the page and try again.",
    missingCsrfSecretMessage: "Owner homepage editing is missing OWNER_CSRF_SECRET in Cloudflare.",
    sameOriginMessage: "Homepage updates must come from the Tobacco Road Games owner site."
  });
  if (!authState.valid) return jsonResponse({ error: authState.userMessage }, authState.status);

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
    requested_by: authState.username,
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
