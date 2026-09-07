import { verifyOfficeAccessRequest } from "./office-access.mjs";
import { attachOfficeCsrf } from "./office-mutation-auth.mjs";
import { jsonResponse } from "./office-validation.mjs";

const NORMAL_SITE_HOSTNAMES = new Set(["tobaccoroadgames.com", "www.tobaccoroadgames.com"]);
const SECURE_OFFICE_ORIGIN = "https://office-staging.tobaccoroadgames.com";

export async function handleOfficeMiddleware(context) {
  const { request, env } = context;
  const entryRedirect = redirectNormalOfficeEntry(request);
  if (entryRedirect) return entryRedirect;
  const access = await verifyOfficeAccessRequest(request, env);
  if (!access.valid) {
    const api = new URL(request.url).pathname.startsWith("/office/api");
    return api
      ? jsonResponse({ error: { code: access.code, message: access.message } }, access.status)
      : deniedPage(access.message, access.status);
  }
  const response = await context.next();
  return ["GET", "HEAD"].includes(request.method.toUpperCase())
    ? attachOfficeCsrf(response, access, env)
    : response;
}

function redirectNormalOfficeEntry(request) {
  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) return null;
  const url = new URL(request.url);
  if (!NORMAL_SITE_HOSTNAMES.has(url.hostname.toLowerCase())) return null;
  const destination = new URL(`${url.pathname}${url.search}`, SECURE_OFFICE_ORIGIN);
  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": "private, no-store",
      location: destination.href
    }
  });
}

function deniedPage(message, status) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>TRG Office</title><main><h1>TRG Office unavailable</h1><p>${escapeHtml(message)}</p></main>`, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
