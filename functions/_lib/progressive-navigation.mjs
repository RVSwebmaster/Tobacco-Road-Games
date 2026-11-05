import { getSessionFromRequest } from "./account-auth.mjs";
import { buildProgressiveNavigation } from "./public-navigation.mjs";

export async function handleProgressiveNavigationRequest(request, env = {}, options = {}) {
  if (request.method !== "GET") {
    return json({ error: { code: "method_not_allowed", message: "Use GET for navigation state." } }, 405);
  }
  const getSession = options.getSession || getSessionFromRequest;
  const session = await getSession(request, env, options.sessionOptions || {});
  if (!session.valid) return json(buildProgressiveNavigation(), 200);

  const database = options.database || env.TRG_ORDERS;
  const creator = await hasCreatorMembership(database, session.user.id, options);
  return json(buildProgressiveNavigation({
    authenticated: true,
    creator,
    role: session.user.role
  }), 200, { "cache-control": "private, no-store, max-age=0" });
}

async function hasCreatorMembership(database, userId, options) {
  if (typeof options.hasCreatorMembership === "function") {
    return Boolean(await options.hasCreatorMembership(userId));
  }
  if (!database?.prepare) return false;
  try {
    return Boolean(await database.prepare(`
      SELECT 1 AS allowed
      FROM creator_memberships cm
      JOIN marketplace_creators c ON c.id=cm.creator_id
      WHERE cm.user_id=?
      LIMIT 1
    `).bind(userId).first());
  } catch (error) {
    if (/no such table:\s*(creator_memberships|marketplace_creators)/i.test(String(error))) return false;
    throw error;
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
