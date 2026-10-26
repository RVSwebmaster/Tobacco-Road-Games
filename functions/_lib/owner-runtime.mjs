export const OWNER_ACTOR_ID = "owner-open-workbench";

export function parseCookieHeader(headerValue) {
  const cookies = new Map();
  const raw = String(headerValue || "");
  for (const pair of raw.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

export function readCookie(request, name) {
  return parseCookieHeader(request.headers.get("cookie")).get(name) || "";
}

export function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`, `Path=${options.path || "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

export function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeFolderName(value) {
  return String(value || "").trim();
}

export function isSafeFolderName(value) {
  const folder = normalizeFolderName(value);
  return Boolean(folder)
    && !folder.includes("/")
    && !folder.includes("\\")
    && !folder.includes("..")
    && /^[A-Za-z0-9 _-]+$/.test(folder);
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
