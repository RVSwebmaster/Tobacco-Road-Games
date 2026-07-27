import { verifyOfficeAccessRequest } from "./office-access.mjs";
import { attachOfficeCsrf } from "./office-mutation-auth.mjs";
import { jsonResponse } from "./office-validation.mjs";

export async function handleOfficeMiddleware(context) {
  const { request, env } = context;
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

