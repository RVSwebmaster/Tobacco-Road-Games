import { getSessionFromRequest } from "./account-auth.mjs";
import {
  createDownloadCredential,
  createNativeDownloadCredential,
  isDownloadSigningSecretConfigured,
} from "./download-authorization.mjs";
import { listNativeEntitlementsForLibrary } from "./native-entitlements-d1.mjs";
import { getRuntimeCatalogProduct } from "./runtime-catalog.mjs";

export async function handleAccountLibraryRequest(request, env = {}, options = {}) {
  if (request.method !== "GET") {
    return json({ error: { code: "method_not_allowed", message: "Use GET for My Library." } }, 405);
  }
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) {
    return json({ error: { code: "not_authenticated", message: "Sign in to view My Library." } }, 401);
  }
  const database = options.database || env.TRG_ORDERS;
  const customerRegistration = await database.prepare("SELECT state FROM customer_registration_states WHERE user_id=?").bind(session.user.id).first();
  if (customerRegistration?.state === "pending") {
    return json({ error: { code: "customer_registration_incomplete", message: "Verify your email and register a payment method to activate Customer access." } }, 403);
  }
  const secret = String(options.downloadSigningSecret || env.DOWNLOAD_SIGNING_SECRET || "");
  const canSign = isDownloadSigningSecretConfigured(secret);
  const owned = new Map();

  const legacyRows = await loadLegacyRows(database, session.user.id);
  for (const row of legacyRows) {
    if (row.catalog_source === "native_d1") continue;
    const current = getRuntimeCatalogProduct(row.product_slug);
    let downloadUrl = "";
    if (canSign && row.entitlement_id && row.entitlement_status === "active") {
      const credential = await createDownloadCredential({
        id: row.entitlement_id,
        order_id: row.order_id,
        order_item_id: row.order_item_id,
        product_slug: row.product_slug,
      }, secret, { nowMs: options.nowMs });
      downloadUrl = `/store/download?credential=${encodeURIComponent(credential)}`;
    }
    const key = libraryKey(row.product_slug);
    if (!owned.has(key)) {
      owned.set(key, { kind: "legacy", item: {
        coverImage: current?.coverUrl || "",
        creator: row.creator_display_name || current?.authorDisplay || creatorFallback(row.author_slugs_json),
        creatorId: row.creator_id || "",
        creatorSlug: row.creator_slug || "",
        currentLastUpdated: current?.lastUpdated || "",
        currentVersion: current?.version || "",
        downloadAvailable: Boolean(row.entitlement_id && row.entitlement_status === "active"),
        downloadUrl,
        orderReference: row.public_id,
        paymentDescription: paymentDescription(row.payment_source),
        productId: row.product_slug,
        productTitle: current?.title || row.product_title_snapshot,
        purchaseAmountCents: integerOrNull(row.line_total_cents),
        purchaseCurrency: String(row.currency || "").toUpperCase(),
        purchaseDate: row.created_at,
        purchasedLastUpdated: row.last_updated_snapshot,
        purchasedVersion: row.version_snapshot,
      } });
    }
  }

  if (session.user.email_verified === 1) {
    const nativeRows = await loadNativeRows(database, session.user.id);
    for (const row of nativeRows) {
      const key = libraryKey(row.product_slug_snapshot || row.native_product_id);
      if (owned.get(key)?.kind === "native") continue;
      let credential = "";
      if (canSign && row.download_reference && row.entitlement_status === "active") {
        credential = await createNativeDownloadCredential(row, secret, { nowMs: options.nowMs });
      }
      const encodedCredential = credential ? encodeURIComponent(credential) : "";
      owned.set(key, { kind: "native", item: {
        coverImage: row.current_cover_r2_key && credential
          ? `/api/account/library-cover?credential=${encodedCredential}`
          : "",
        creator: row.creator_display_name || creatorFallback(row.author_slugs_json),
        creatorId: row.native_creator_id,
        creatorSlug: row.creator_slug || firstAuthorSlug(row.author_slugs_json),
        currentLastUpdated: row.current_updated_at || "",
        currentVersion: "",
        downloadAvailable: row.entitlement_status === "active",
        downloadUrl: credential ? `/store/download?credential=${encodedCredential}` : "",
        orderReference: row.public_id,
        paymentDescription: paymentDescription(row.payment_source),
        productId: row.native_product_id,
        productTitle: row.product_title_snapshot,
        purchaseAmountCents: integerOrNull(row.selected_price_cents_snapshot),
        purchaseCurrency: String(row.currency_snapshot || "").toUpperCase(),
        purchaseDate: row.acquired_at || row.created_at,
        purchasedLastUpdated: row.last_updated_snapshot,
        purchasedVersion: row.version_snapshot,
      } });
    }
  }

  const items = [...owned.values()]
    .map((entry) => entry.item)
    .sort((left, right) => String(right.purchaseDate).localeCompare(String(left.purchaseDate)));
  return json({ items }, 200, { "cache-control": "private, no-store, max-age=0" });
}

async function loadLegacyRows(database, userId) {
  try {
    return await allRows(database.prepare(`
      SELECT o.public_id,o.created_at,o.payment_source,o.catalog_source,
        oi.product_slug,oi.product_title_snapshot,oi.author_slugs_json,
        oi.version_snapshot,oi.last_updated_snapshot,oi.line_total_cents,oi.currency,
        de.id AS entitlement_id,de.order_id,de.order_item_id,de.status AS entitlement_status,
        cl.creator_id,c.slug AS creator_slug,c.display_name AS creator_display_name
      FROM orders o
      JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN download_entitlements de
        ON de.order_item_id=oi.id AND de.order_id=o.id AND de.status='active'
      LEFT JOIN creator_listings cl ON cl.source_product_slug=oi.product_slug
      LEFT JOIN marketplace_creators c ON c.id=cl.creator_id
      WHERE o.user_id=? AND o.payment_status='paid'
      ORDER BY o.created_at DESC,oi.id ASC
    `).bind(userId));
  } catch (error) {
    if (!/no such (table:\s*(creator_listings|marketplace_creators)|column:\s*o\.(payment_source|catalog_source))/i.test(String(error))) {
      throw error;
    }
    return allRows(database.prepare(`
      SELECT o.public_id,o.created_at,oi.product_slug,oi.product_title_snapshot,
        oi.author_slugs_json,oi.version_snapshot,oi.last_updated_snapshot,
        oi.line_total_cents,oi.currency,
        de.id AS entitlement_id,de.order_id,de.order_item_id,de.status AS entitlement_status
      FROM orders o JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN download_entitlements de
        ON de.order_item_id=oi.id AND de.order_id=o.id AND de.status='active'
      WHERE o.user_id=? AND o.payment_status='paid'
      ORDER BY o.created_at DESC,oi.id ASC
    `).bind(userId));
  }
}

async function loadNativeRows(database, userId) {
  try {
    return await listNativeEntitlementsForLibrary(database, userId);
  } catch (error) {
    if (/no such table:\s*(native_product_entitlements|marketplace_products)/i.test(String(error))) return [];
    throw error;
  }
}

function paymentDescription(source) {
  return source === "creator_balance" ? "Paid with Creator Balance" : "Paid through secure checkout";
}
function libraryKey(value) {
  return String(value || "").trim().toLowerCase();
}
function firstAuthorSlug(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? String(parsed[0] || "") : "";
  } catch {
    return "";
  }
}
function creatorFallback(value) {
  const slug = firstAuthorSlug(value);
  return slug
    ? slug.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ")
    : "";
}
function integerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
async function allRows(statement) {
  const result = await statement.all();
  return result.results || [];
}
function json(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
