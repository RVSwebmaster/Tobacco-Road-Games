export const STORE_STATES = Object.freeze(["OPEN", "CLOSED", "MAINTENANCE"]);
export const STORE_STATE_KEY = "store_state";

export function normalizeStoreState(value) {
  const state = String(value || "").trim().toUpperCase();
  return STORE_STATES.includes(state) ? state : "";
}

export async function readStoreState(env = {}, options = {}) {
  const database = options.database || env.TRG_ORDERS || null;
  if (!database) {
    return { available: false, state: "CLOSED", reason: "missing_database" };
  }

  try {
    const row = await database.prepare(
      "SELECT setting_value, updated_at, updated_by FROM runtime_settings WHERE setting_key = ?"
    ).bind(STORE_STATE_KEY).first();
    const state = normalizeStoreState(row?.setting_value);
    if (!state) {
      return { available: false, state: "CLOSED", reason: "missing_or_invalid_state" };
    }
    return {
      available: true,
      state,
      updatedAt: String(row.updated_at || ""),
      updatedBy: String(row.updated_by || "")
    };
  } catch {
    return { available: false, state: "CLOSED", reason: "read_failed" };
  }
}

export async function writeStoreState(env = {}, state, updatedBy, options = {}) {
  const normalized = normalizeStoreState(state);
  if (!normalized) {
    throw new Error("Store state must be OPEN, CLOSED, or MAINTENANCE.");
  }
  const database = options.database || env.TRG_ORDERS || null;
  if (!database) {
    throw new Error("The TRG_ORDERS database binding is missing.");
  }
  const updatedAt = new Date(options.now || Date.now()).toISOString();
  await database.prepare(`INSERT INTO runtime_settings (setting_key, setting_value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by`).bind(
    STORE_STATE_KEY,
    normalized,
    updatedAt,
    String(updatedBy || "owner")
  ).run();
  return { available: true, state: normalized, updatedAt, updatedBy: String(updatedBy || "owner") };
}

export function storeClosedResponse(state = "CLOSED") {
  return new Response(JSON.stringify({
    error: state === "MAINTENANCE"
      ? "The store is currently undergoing maintenance. Checkout is unavailable."
      : "The store is temporarily closed while work is being done. Checkout is unavailable.",
    code: "store_not_open",
    storeState: state
  }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    status: 503
  });
}
