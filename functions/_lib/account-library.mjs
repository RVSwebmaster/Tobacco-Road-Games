import { getSessionFromRequest } from "./account-auth.mjs";
import { createDownloadCredential, isDownloadSigningSecretConfigured } from "./download-authorization.mjs";
import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";

export async function handleAccountLibraryRequest(request, env = {}, options = {}) {
  if (request.method !== "GET") return json({ error: { code: "method_not_allowed", message: "Use GET for My Library." } }, 405);
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return json({ error: { code: "not_authenticated", message: "Sign in to view My Library." } }, 401);
  const database = options.database || env.TRG_ORDERS;
  const rows = await allRows(database.prepare(`
    SELECT o.public_id, o.created_at, oi.product_slug, oi.product_title_snapshot,
           oi.author_slugs_json, oi.version_snapshot, oi.last_updated_snapshot,
           de.id AS entitlement_id, de.order_id, de.order_item_id, de.status AS entitlement_status
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN download_entitlements de
      ON de.order_item_id = oi.id AND de.order_id = o.id AND de.status = 'active'
    WHERE o.user_id = ? AND o.payment_status = 'paid'
    ORDER BY o.created_at DESC, oi.id ASC
  `).bind(session.user.id));
  const secret = String(options.downloadSigningSecret || env.DOWNLOAD_SIGNING_SECRET || "");
  const canSign = isDownloadSigningSecretConfigured(secret);
  const items = [];
  for (const row of rows) {
    const current = getRuntimeCatalogProduct(row.product_slug);
    let downloadUrl = "";
    if (canSign && row.entitlement_id && row.entitlement_status === "active") {
      const credential = await createDownloadCredential({ id: row.entitlement_id, order_id: row.order_id, order_item_id: row.order_item_id, product_slug: row.product_slug }, secret, { nowMs: options.nowMs });
      downloadUrl = `/store/download?credential=${encodeURIComponent(credential)}`;
    }
    items.push({
      coverImage: current?.coverUrl || "",
      creator: current?.authorDisplay || "",
      currentLastUpdated: current?.lastUpdated || "",
      currentVersion: current?.version || "",
      downloadAvailable: Boolean(row.entitlement_id && row.entitlement_status === "active"),
      downloadUrl,
      orderReference: row.public_id,
      productId: row.product_slug,
      productTitle: current?.title || row.product_title_snapshot,
      purchaseDate: row.created_at,
      purchasedLastUpdated: row.last_updated_snapshot,
      purchasedVersion: row.version_snapshot
    });
  }
  return json({ items }, 200, { "cache-control": "private, no-store, max-age=0" });
}

async function allRows(statement) { const result = await statement.all(); return result.results || []; }
function json(payload, status, extraHeaders = {}) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } }); }
