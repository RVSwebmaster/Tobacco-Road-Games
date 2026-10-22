import { jsonResponse } from "./owner-auth.mjs";
import {
  verifyAuthenticatedOwnerMutationRequest,
  verifyAuthenticatedOwnerReadRequest,
} from "./owner-mutation-auth.mjs";

export const RV_CREATOR_ID = "creator-rv-sawyer";
export const RV_CREATOR_SLUG = "rv-sawyer";
export const MAX_LIBRARY_SELECTIONS = 36;
export const MAX_PROFILE_SHELF_SELECTIONS = 12;

export const PROFILE_PALETTE = Object.freeze({
  walnut: "#20150f",
  moss: "#17251d",
  parchment: "#e8dcc0",
  midnight: "#111820",
  oxblood: "#321714",
});

export const PREPARED_WALLPAPERS = Object.freeze({
  "trg-classic": "/assets/wallpaper.png",
});

export const OWNER_POSTER_ASSETS = Object.freeze({
  "white-plume-mountain": "/assets/white-plume-mountain-framed.png",
  "dragon-battle": "/assets/dragon-battle-framed-poster.png",
  "cape-fear": "/assets/cape-fear-framed-poster.png",
  "dungeon-masters-guide": "/assets/dungeon-masters-guide-framed-poster.png",
  "the-familiar": "/assets/the-familiar-framed-poster.png",
  "blackbeard": "/assets/blackbeard-framed-flag.png",
  "michael-jordan": "/assets/michael-jordan-framed-jersey.png",
  "call-of-cthulhu": "/assets/call-of-cthulhu-framed-poster.png",
  "krispy-kreme": "/assets/krispy-kreme-framed-sign.png",
  "justifiers": "/assets/justifiers-framed-cover.png",
  "charlie-daniels": "/assets/charlie-daniels-framed-art.png",
  "drolla": "/assets/drolla-framed-cover.png",
});

export async function handleOwnerProfileRequest(request, env = {}, options = {}) {
  const database = options.database || env.TRG_ORDERS;
  if (!database) return jsonResponse({ error: "Owner profile storage is unavailable." }, 503);
  const method = String(request.method || "GET").toUpperCase();
  if (method === "GET") {
    const auth = await verifyAuthenticatedOwnerReadRequest(request, env, options);
    if (!auth.valid) return jsonResponse({ error: auth.userMessage }, auth.status);
    return jsonResponse(await buildPrivateOwnerProfile(database), 200, privateHeaders());
  }
  if (method !== "POST") return jsonResponse({ error: "Use GET or POST for the Owner Profile." }, 405);

  const auth = await verifyAuthenticatedOwnerMutationRequest(request, env, options);
  if (!auth.valid) return jsonResponse({ error: auth.userMessage }, auth.status);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Owner Profile updates must be valid JSON." }, 400); }
  const identity = await getRvIdentity(database);
  if (!identity) return jsonResponse({ error: "RV Sawyer's canonical Creator identity is not linked to an account." }, 409);
  const now = new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString();
  try {
    if (body.action === "save_library") {
      await saveLibrarySelections(database, identity, body.productSlugs, auth.username, now);
    } else if (body.action === "save_shelf") {
      await saveShelfSelections(database, identity, body.listingIds, auth.username, now);
    } else if (body.action === "save_appearance") {
      await saveAppearance(database, identity, body, auth.username, now);
    } else if (body.action === "save_posters") {
      await savePosters(database, identity, body.posters, auth.username, now);
    } else {
      return jsonResponse({ error: "Owner Profile action is invalid." }, 400);
    }
    return jsonResponse({ ok: true, profile: await buildPrivateOwnerProfile(database) }, 200, privateHeaders());
  } catch (error) {
    return jsonResponse({ error: error?.message || "Owner Profile update failed." }, 409);
  }
}

export async function handlePublicCreatorProfileRequest(request, env = {}, options = {}) {
  if (String(request.method || "GET").toUpperCase() !== "GET") return jsonResponse({ error: "Use GET for public Creator profiles." }, 405);
  const database = options.database || env.TRG_ORDERS;
  if (!database) return jsonResponse({ error: "Creator profile storage is unavailable." }, 503);
  const slug = String(options.slug || new URL(request.url).pathname.split("/").filter(Boolean).at(-1) || "").toLowerCase();
  if (slug !== RV_CREATOR_SLUG) return jsonResponse({ error: "Creator profile not found." }, 404);
  const identity = await getRvIdentity(database);
  const creator = await database.prepare("SELECT id,slug,display_name,profile_image,logo,banner_image,short_bio,long_bio,profile_template,accent,links_json FROM marketplace_creators WHERE id=? AND marketplace_status='approved'").bind(RV_CREATOR_ID).first();
  if (!creator) return jsonResponse({ error: "Creator profile not found." }, 404);
  const appearance = identity ? await getAppearance(database, identity.owner_user_id) : defaultAppearance();
  const catalog = await listRows(database.prepare(`${publicListingSelect()} WHERE cl.creator_id=? AND ${saleableSql("cl")} ORDER BY cl.title`).bind(RV_CREATOR_ID));
  const shelved = await listRows(database.prepare(`${publicListingSelect()} JOIN creator_profile_shelf_selections ps ON ps.listing_id=cl.id AND ps.creator_id=cl.creator_id WHERE cl.creator_id=? AND ${saleableSql("cl")} ORDER BY ps.position`).bind(RV_CREATOR_ID));
  const posters = await getPosters(database, RV_CREATOR_ID);
  return jsonResponse({
    creator: {
      slug: creator.slug,
      displayName: creator.display_name,
      profileImage: creator.profile_image,
      logo: creator.logo,
      bannerImage: creator.banner_image,
      shortBio: creator.short_bio,
      longBio: creator.long_bio,
      profileTemplate: creator.profile_template,
      accent: creator.accent,
      links: safeJson(creator.links_json, []),
    },
    appearance,
    catalog: catalog.map(publicListing),
    shelved: shelved.map(publicListing),
    posters,
  }, 200, { "cache-control": "public, max-age=60" });
}

async function buildPrivateOwnerProfile(database) {
  const identity = await getRvIdentity(database);
  const creator = await database.prepare("SELECT * FROM marketplace_creators WHERE id=?").bind(RV_CREATOR_ID).first();
  if (!identity || !creator) {
    return { configured: false, creator: creator ? { id: creator.id, slug: creator.slug, displayName: creator.display_name } : null };
  }
  const [purchases, catalog, shelved, posters, appearance, community] = await Promise.all([
    getPurchases(database, identity.owner_user_id),
    listRows(database.prepare("SELECT id,slug,title,lifecycle_state,publication_state,public_product_slug,cover_image,listed_price_cents,updated_at FROM creator_listings WHERE creator_id=? ORDER BY title").bind(RV_CREATOR_ID)),
    listRows(database.prepare("SELECT ps.position,cl.id,cl.slug,cl.title,cl.lifecycle_state,cl.publication_state,cl.public_product_slug,cl.cover_image FROM creator_profile_shelf_selections ps JOIN creator_listings cl ON cl.id=ps.listing_id WHERE ps.creator_id=? ORDER BY ps.position").bind(RV_CREATOR_ID)),
    getPosters(database, RV_CREATOR_ID),
    getAppearance(database, identity.owner_user_id),
    getCommunitySummary(database, identity.owner_user_id),
  ]);
  return {
    configured: true,
    creator: { id: creator.id, slug: creator.slug, displayName: creator.display_name },
    purchases,
    catalog: catalog.map((item) => ({
      id: item.id, slug: item.slug, title: item.title, lifecycleState: item.lifecycle_state,
      publicationState: item.publication_state, publicProductSlug: item.public_product_slug || "",
      coverImage: item.cover_image || "", listedPriceCents: item.listed_price_cents, updatedAt: item.updated_at,
    })),
    shelved: shelved.map((item) => ({
      position: item.position, id: item.id, slug: item.slug, title: item.title,
      lifecycleState: item.lifecycle_state, publicationState: item.publication_state,
      publicProductSlug: item.public_product_slug || "", coverImage: item.cover_image || "",
    })),
    appearance,
    posters,
    community,
    manifests: {
      palette: PROFILE_PALETTE,
      preparedWallpapers: PREPARED_WALLPAPERS,
      posterAssets: OWNER_POSTER_ASSETS,
    },
    limits: { library: MAX_LIBRARY_SELECTIONS, shelf: MAX_PROFILE_SHELF_SELECTIONS, posters: 2 },
  };
}

async function getRvIdentity(database) {
  return database.prepare("SELECT creator_id,owner_user_id FROM creator_identity_ownership WHERE creator_id=? AND account_status='active'").bind(RV_CREATOR_ID).first();
}

async function getPurchases(database, userId) {
  const rows = await listRows(database.prepare(`
    SELECT oi.product_slug,oi.product_title_snapshot,oi.author_slugs_json,oi.version_snapshot,
           o.public_id,o.created_at,de.id entitlement_id,
           COALESCE(ls.position,0) selected_position
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    JOIN download_entitlements de ON de.order_id=o.id AND de.order_item_id=oi.id AND de.status='active'
    LEFT JOIN account_library_shelf_selections ls ON ls.user_id=o.user_id AND ls.product_slug=oi.product_slug
    WHERE o.user_id=? AND o.payment_status='paid'
    ORDER BY CASE WHEN ls.position IS NULL THEN 1 ELSE 0 END,ls.position,o.created_at DESC
  `).bind(userId));
  const seen = new Set();
  return rows.filter((row) => !seen.has(row.product_slug) && seen.add(row.product_slug)).map((row) => ({
    productSlug: row.product_slug,
    productTitle: row.product_title_snapshot,
    authorSlugs: safeJson(row.author_slugs_json, []),
    purchasedVersion: row.version_snapshot,
    orderReference: row.public_id,
    purchaseDate: row.created_at,
    selected: Number(row.selected_position) > 0,
    position: Number(row.selected_position) || null,
  }));
}

async function saveLibrarySelections(database, identity, values, actor, now) {
  const slugs = normalizedUnique(values, MAX_LIBRARY_SELECTIONS, "personal-library products");
  if (slugs.length) {
    const eligible = await listRows(database.prepare(`SELECT DISTINCT oi.product_slug FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN download_entitlements de ON de.order_id=o.id AND de.order_item_id=oi.id AND de.status='active' WHERE o.user_id=? AND o.payment_status='paid' AND oi.product_slug IN (${slugs.map(() => "?").join(",")})`).bind(identity.owner_user_id, ...slugs));
    const allowed = new Set(eligible.map((row) => row.product_slug));
    const invalid = slugs.find((slug) => !allowed.has(slug));
    if (invalid) throw new Error("Only purchased products with active download access may be placed in Your Library.");
  }
  const statements = [database.prepare("DELETE FROM account_library_shelf_selections WHERE user_id=?").bind(identity.owner_user_id)];
  slugs.forEach((slug, index) => statements.push(database.prepare("INSERT INTO account_library_shelf_selections(user_id,product_slug,position,created_at,updated_at) VALUES(?,?,?,?,?)").bind(identity.owner_user_id, slug, index + 1, now, now)));
  statements.push(audit(database, identity, actor, "library_shelf_updated", { productSlugs: slugs }, now));
  await database.batch(statements);
}

async function saveShelfSelections(database, identity, values, actor, now) {
  const ids = normalizedUnique(values, MAX_PROFILE_SHELF_SELECTIONS, "profile shelf products");
  if (ids.length) {
    const eligible = await listRows(database.prepare(`SELECT id FROM creator_listings cl WHERE creator_id=? AND id IN (${ids.map(() => "?").join(",")}) AND ${saleableSql("cl")}`).bind(RV_CREATOR_ID, ...ids));
    const allowed = new Set(eligible.map((row) => row.id));
    if (ids.some((id) => !allowed.has(id))) throw new Error("Only RV Sawyer's published, saleable products may occupy the public profile shelf.");
  }
  const statements = [database.prepare("DELETE FROM creator_profile_shelf_selections WHERE creator_id=?").bind(RV_CREATOR_ID)];
  ids.forEach((id, index) => statements.push(database.prepare("INSERT INTO creator_profile_shelf_selections(creator_id,listing_id,position,created_at,updated_at) VALUES(?,?,?,?,?)").bind(RV_CREATOR_ID, id, index + 1, now, now)));
  statements.push(audit(database, identity, actor, "creator_profile_shelf_updated", { listingIds: ids }, now));
  await database.batch(statements);
}

async function saveAppearance(database, identity, body, actor, now) {
  const appearanceMode = ["day", "night"].includes(body.appearanceMode) ? body.appearanceMode : null;
  const wallpaperKind = ["solid", "prepared"].includes(body.wallpaperKind) ? body.wallpaperKind : null;
  const wallpaperKey = String(body.wallpaperKey || "");
  const saturation = Number(body.wallpaperSaturation);
  if (!appearanceMode || !wallpaperKind || !Number.isInteger(saturation) || saturation < 0 || saturation > 150) throw new Error("Profile appearance settings are invalid.");
  if (wallpaperKind === "solid" && !PROFILE_PALETTE[wallpaperKey]) throw new Error("Choose an approved solid profile color.");
  if (wallpaperKind === "prepared" && !PREPARED_WALLPAPERS[wallpaperKey]) throw new Error("Choose an approved Tobacco Road Games profile wallpaper.");
  const color = wallpaperKind === "solid" ? PROFILE_PALETTE[wallpaperKey] : PROFILE_PALETTE.walnut;
  await database.batch([
    database.prepare(`INSERT INTO account_profile_preferences(user_id,appearance_mode,wallpaper_kind,wallpaper_key,wallpaper_color,wallpaper_saturation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET appearance_mode=excluded.appearance_mode,wallpaper_kind=excluded.wallpaper_kind,wallpaper_key=excluded.wallpaper_key,wallpaper_color=excluded.wallpaper_color,wallpaper_saturation=excluded.wallpaper_saturation,updated_at=excluded.updated_at`).bind(identity.owner_user_id, appearanceMode, wallpaperKind, wallpaperKey, color, saturation, now, now),
    audit(database, identity, actor, "profile_appearance_updated", { appearanceMode, wallpaperKind, wallpaperKey, wallpaperSaturation: saturation }, now),
  ]);
}

async function savePosters(database, identity, values, actor, now) {
  const posters = Array.isArray(values) ? values.slice(0, 2) : [];
  if (Array.isArray(values) && values.length > 2) throw new Error("The Owner Profile supports two poster positions.");
  const normalized = posters.map((poster, index) => ({ slot: index + 1, assetKey: String(poster?.assetKey || ""), altText: String(poster?.altText || "").trim().slice(0, 180) })).filter((poster) => poster.assetKey);
  if (normalized.some((poster) => !OWNER_POSTER_ASSETS[poster.assetKey])) throw new Error("Choose poster artwork from the approved Owner poster collection.");
  const statements = [database.prepare("DELETE FROM creator_profile_posters WHERE creator_id=?").bind(RV_CREATOR_ID)];
  normalized.forEach((poster) => statements.push(database.prepare("INSERT INTO creator_profile_posters(creator_id,slot,asset_key,alt_text,owner_managed,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").bind(RV_CREATOR_ID, poster.slot, poster.assetKey, poster.altText, now, now)));
  statements.push(audit(database, identity, actor, "creator_profile_posters_updated", { posters: normalized.map(({ slot, assetKey }) => ({ slot, assetKey })) }, now));
  await database.batch(statements);
}

async function getAppearance(database, userId) {
  const row = await database.prepare("SELECT appearance_mode,wallpaper_kind,wallpaper_key,wallpaper_color,wallpaper_saturation FROM account_profile_preferences WHERE user_id=?").bind(userId).first();
  if (!row) return defaultAppearance();
  const assetUrl = row.wallpaper_kind === "prepared" ? PREPARED_WALLPAPERS[row.wallpaper_key] || "" : "";
  return { appearanceMode: row.appearance_mode, wallpaperKind: row.wallpaper_kind, wallpaperKey: row.wallpaper_key, wallpaperColor: row.wallpaper_color, wallpaperSaturation: Number(row.wallpaper_saturation), wallpaperUrl: assetUrl };
}

function defaultAppearance() {
  return { appearanceMode: "night", wallpaperKind: "solid", wallpaperKey: "walnut", wallpaperColor: PROFILE_PALETTE.walnut, wallpaperSaturation: 100, wallpaperUrl: "" };
}

async function getPosters(database, creatorId) {
  const rows = await listRows(database.prepare("SELECT slot,asset_key,alt_text FROM creator_profile_posters WHERE creator_id=? AND owner_managed=1 ORDER BY slot").bind(creatorId));
  return rows.filter((row) => OWNER_POSTER_ASSETS[row.asset_key]).map((row) => ({ slot: Number(row.slot), assetKey: row.asset_key, assetUrl: OWNER_POSTER_ASSETS[row.asset_key], altText: row.alt_text }));
}

async function getCommunitySummary(database, userId) {
  let forumProfile = null;
  let forumTopics = 0;
  let forumReplies = 0;
  try {
    forumProfile = await database.prepare("SELECT handle,status FROM forum_profiles WHERE user_id=?").bind(userId).first();
    if (forumProfile) {
      const topic = await database.prepare("SELECT COUNT(*) total FROM forum_topics WHERE creator_profile_id=?").bind(userId).first();
      const replies = await database.prepare("SELECT COUNT(*) total FROM forum_posts WHERE author_profile_id=?").bind(userId).first();
      forumTopics = Number(topic?.total || 0);
      forumReplies = Number(replies?.total || 0);
    }
  } catch { /* Older fixtures may not include forum tables. */ }
  return { forumProfile: forumProfile ? { handle: forumProfile.handle, status: forumProfile.status, topicCount: forumTopics, replyCount: forumReplies } : null, messagesAvailable: false, customerRewardsAvailable: false };
}

function audit(database, identity, actor, action, context, now) {
  return database.prepare("INSERT INTO profile_customization_audit(user_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,'owner',?,?,?,?)").bind(identity.owner_user_id, RV_CREATOR_ID, String(actor || "owner"), action, JSON.stringify(context), now);
}

function normalizedUnique(values, maximum, label) {
  if (!Array.isArray(values)) throw new Error(`Choose ${label} as a list.`);
  const normalized = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (normalized.length > maximum) throw new Error(`No more than ${maximum} ${label} may be selected.`);
  return normalized;
}

function saleableSql(alias) {
  return `${alias}.lifecycle_state='active' AND ${alias}.publication_state='published' AND COALESCE(${alias}.owner_review_hold,0)=0 AND COALESCE(${alias}.inactivity_state,'active')<>'inactive'`;
}

function publicListingSelect() {
  return "SELECT cl.id,cl.slug,cl.title,cl.short_description,cl.public_product_slug,cl.cover_image,cl.listed_price_cents,cl.pricing_model FROM creator_listings cl";
}

function publicListing(row) {
  return { id: row.id, slug: row.slug, title: row.title, shortDescription: row.short_description || "", publicProductSlug: row.public_product_slug || "", url: row.public_product_slug ? `/store/products/${encodeURIComponent(row.public_product_slug)}/` : "", coverImage: row.cover_image || "", listedPriceCents: row.listed_price_cents, pricingModel: row.pricing_model || "fixed" };
}

async function listRows(statement) {
  const result = await statement.all();
  return result.results || [];
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function privateHeaders() {
  return { "cache-control": "private, no-store, max-age=0" };
}
