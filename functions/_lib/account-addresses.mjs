import { getSessionFromRequest, validateSameOriginRequest, validateSessionCsrf } from "./account-auth.mjs";

export async function handleAccountAddressesRequest(request, env = {}, options = {}) {
  const db = options.database || env.TRG_ORDERS;
  const session = await getSessionFromRequest(request, env, options.sessionOptions || {});
  if (!session.valid) return json({ error: { message: "Sign in to manage saved addresses." } }, 401);
  if (!validateSameOriginRequest(request) || !(await validateSessionCsrf(request, session)).valid) {
    return json({ error: { message: "The address request could not be verified." } }, 403);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    if (request.method === "POST") return json({ ok: true, address: await saveAddress(db, session.user.id, body, options) });
    if (request.method === "DELETE") return json({ ok: true, removed: await removeAddress(db, session.user.id, body.id) });
    return json({ error: { message: "Use POST or DELETE." } }, 405);
  } catch (error) {
    return json({ error: { message: error.message } }, 400);
  }
}

export async function saveAddress(db, userId, input = {}, options = {}) {
  const address = {
    id: clean(input.id, 80) || crypto.randomUUID(),
    label: clean(input.label, 40),
    recipientName: clean(input.recipientName, 160),
    addressLine1: clean(input.addressLine1, 200),
    addressLine2: clean(input.addressLine2, 200),
    city: clean(input.city, 100),
    stateRegion: clean(input.stateRegion, 100),
    postalCode: clean(input.postalCode, 30),
    country: clean(input.country, 2).toUpperCase(),
    isDefault: Boolean(input.isDefault)
  };
  if (!address.recipientName || !address.addressLine1 || !address.city || !address.postalCode || !/^[A-Z]{2}$/.test(address.country)) {
    throw new Error("Recipient, street, city, postal code, and two-letter country are required.");
  }
  const now = new Date(options.nowMs || Date.now()).toISOString();
  const existing = await db.prepare("SELECT user_id FROM user_shipping_addresses WHERE id=?").bind(address.id).first();
  if (existing && existing.user_id !== userId) throw new Error("That saved address belongs to a different account.");
  if (address.isDefault) await db.prepare("UPDATE user_shipping_addresses SET is_default=0,updated_at=? WHERE user_id=?").bind(now, userId).run();
  await db.prepare(`INSERT INTO user_shipping_addresses(id,user_id,label,recipient_name,address_line1,address_line2,city,state_region,postal_code,country,is_default,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,recipient_name=excluded.recipient_name,address_line1=excluded.address_line1,address_line2=excluded.address_line2,city=excluded.city,state_region=excluded.state_region,postal_code=excluded.postal_code,country=excluded.country,is_default=excluded.is_default,updated_at=excluded.updated_at WHERE user_shipping_addresses.user_id=excluded.user_id`)
    .bind(address.id, userId, address.label, address.recipientName, address.addressLine1, address.addressLine2, address.city, address.stateRegion, address.postalCode, address.country, Number(address.isDefault), now, now).run();
  const stored = await db.prepare("SELECT id,label,recipient_name,address_line1,address_line2,city,state_region,postal_code,country,is_default FROM user_shipping_addresses WHERE id=? AND user_id=?").bind(address.id, userId).first();
  if (!stored) throw new Error("The saved address could not be stored.");
  return stored;
}

export async function removeAddress(db, userId, id) {
  const key = clean(id, 80);
  if (!key) throw new Error("Choose a saved address to remove.");
  const result = await db.prepare("DELETE FROM user_shipping_addresses WHERE id=? AND user_id=?").bind(key, userId).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

function clean(value, max) { return String(value || "").trim().slice(0, max); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "cache-control": "private, no-store", "content-type": "application/json" } }); }
