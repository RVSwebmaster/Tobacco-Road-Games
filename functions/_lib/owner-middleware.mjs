import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  buildOwnerLoginLocation,
  clearCookie,
  verifySessionToken
} from "./owner-auth.mjs";

export async function handleOwnerMiddleware(context) {
  const request = context.request;
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;

  if (!pathname.startsWith("/owner")) {
    return context.next();
  }

  if (pathname === "/owner" || pathname === "/owner/") {
    const hasSession = await hasValidOwnerSession(request, context.env);
    if (hasSession) {
      return Response.redirect(new URL("/owner/product-intake.html", request.url).toString(), 303);
    }
    return redirectToOwnerLogin(request);
  }

  if (pathname === "/owner/login" || pathname === "/owner/logout" || pathname.startsWith("/owner/api/")) {
    return context.next();
  }

  const session = await readOwnerSession(request, context.env);
  if (session.valid) {
    return context.next();
  }

  return redirectToOwnerLogin(request, session.reason === "expired" || session.reason === "bad_signature");
}

export async function readOwnerSession(request, env) {
  const secret = String(env.OWNER_SESSION_SECRET || "");
  const token = getCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!secret || !token) {
    return { valid: false, reason: "missing" };
  }
  return verifySessionToken(token, secret);
}

async function hasValidOwnerSession(request, env) {
  const session = await readOwnerSession(request, env);
  return session.valid;
}

function redirectToOwnerLogin(request, clearInvalidCookies = false) {
  const requestUrl = new URL(request.url);
  const nextPath = requestUrl.pathname + requestUrl.search;
  const headers = new Headers({
    location: buildOwnerLoginLocation(requestUrl.toString(), nextPath)
  });

  if (clearInvalidCookies) {
    headers.append("set-cookie", clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/owner",
      sameSite: "Strict"
    }));
    headers.append("set-cookie", clearCookie(CSRF_COOKIE_NAME, {
      path: "/owner",
      sameSite: "Strict"
    }));
  }

  return new Response(null, {
    status: 303,
    headers
  });
}

function getCookie(cookieHeader, name) {
  const raw = String(cookieHeader || "");
  for (const part of raw.split(";")) {
    const [cookieName, ...cookieValue] = part.trim().split("=");
    if (cookieName === name) {
      return cookieValue.join("=");
    }
  }
  return "";
}
