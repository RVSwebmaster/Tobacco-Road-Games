import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  buildCookie,
  buildOwnerLoginLocation,
  clearCookie,
  createCsrfToken,
  createSessionToken,
  getOwnerSecrets,
  getSafeOwnerNextPath,
  htmlResponse,
  inspectPasswordHash,
  readCookie,
  verifyPasswordHash,
  verifySessionToken
} from "./owner-auth.mjs";
import {
  buildOwnerAccessDeniedResponse,
  buildOwnerAccessLogoutUrl,
  getOwnerAccessConfig,
  verifyOwnerAccessRequest
} from "./owner-access.mjs";

export async function handleOwnerLoginRequest(request, env) {
  const url = new URL(request.url);
  const accessConfig = getOwnerAccessConfig(env);

  try {
    if (accessConfig.enabled) {
      return await handleAccessProtectedLogin(request, env, url, accessConfig);
    }

    const method = request.method.toUpperCase();

    if (method === "GET") {
      return await handleLoginGet(request, env, url);
    }

    if (method === "POST") {
      return await handleLoginPost(request, env, url);
    }

    return htmlResponse(renderLoginPage({
      errorMessage: "This page only supports GET and POST.",
      nextPath: getSafeOwnerNextPath(url.searchParams.get("next"))
    }), 405);
  } catch (error) {
    logOwnerLoginException(request, error);
    return htmlResponse(renderLoginPage({
      errorMessage: "Owner login could not be completed. Please try again or check Cloudflare login secret configuration.",
      nextPath: getSafeOwnerNextPath(url.searchParams.get("next"))
    }), 500);
  }
}

export async function handleOwnerLogoutRequest(request, env) {
  if (getOwnerAccessConfig(env).enabled) {
    const headers = new Headers({ location: buildOwnerAccessLogoutUrl(request) });
    headers.append("set-cookie", clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/",
      sameSite: "Strict"
    }));
    headers.append("set-cookie", clearCookie(CSRF_COOKIE_NAME, {
      path: "/owner",
      sameSite: "Strict"
    }));
    return new Response(null, { headers, status: 303 });
  }

  const redirectUrl = new URL("/owner/login", request.url);
  redirectUrl.searchParams.set("logged_out", "1");
  const headers = new Headers({
    location: redirectUrl.toString()
  });
  headers.append("set-cookie", clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "Strict"
  }));
  headers.append("set-cookie", clearCookie(CSRF_COOKIE_NAME, {
    path: "/owner",
    sameSite: "Strict"
  }));

  return new Response(null, {
    status: 303,
    headers
  });
}

async function handleAccessProtectedLogin(request, env, url, accessConfig) {
  if (!accessConfig.ready) {
    return buildOwnerAccessDeniedResponse(request, {
      reason: "config_incomplete",
      userMessage: "Owner access is partially configured. Add OWNER_ACCESS_TEAM_DOMAIN and OWNER_ACCESS_AUD together."
    });
  }

  const accessState = await verifyOwnerAccessRequest(request, env);
  if (!accessState.valid) {
    return buildOwnerAccessDeniedResponse(request, accessState);
  }

  const nextPath = getSafeOwnerNextPath(url.searchParams.get("next"));
  return Response.redirect(new URL(nextPath, request.url).toString(), 303);
}

async function handleLoginGet(request, env, url) {
  const nextPath = getSafeOwnerNextPath(url.searchParams.get("next"));
  const { sessionSecret } = getOwnerSecrets(env);
  const existingSession = readCookie(request, SESSION_COOKIE_NAME);

  if (existingSession && sessionSecret) {
    const session = await verifySessionToken(existingSession, sessionSecret);
    if (session.valid) {
      return Response.redirect(new URL(nextPath, request.url).toString(), 303);
    }
  }

  return htmlResponse(renderLoginPage({
    loggedOut: url.searchParams.get("logged_out") === "1",
    nextPath
  }));
}

async function handleLoginPost(request, env, url) {
  const nextPath = getSafeOwnerNextPath(url.searchParams.get("next"));
  const secrets = getOwnerSecrets(env);
  if (!secrets.username || !secrets.passwordHash || !secrets.sessionSecret || !secrets.csrfSecret) {
    return htmlResponse(renderLoginPage({
      errorMessage: "Owner login is not configured yet. Add the required Cloudflare secrets first.",
      nextPath
    }), 503);
  }

  const passwordHashState = inspectPasswordHash(secrets.passwordHash);
  if (!passwordHashState.valid) {
    return htmlResponse(renderLoginPage({
      errorMessage: "Owner login is not configured correctly yet. Update OWNER_PASSWORD_HASH in Cloudflare and try again.",
      nextPath
    }), 503);
  }

  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  const usernameMatches = username === secrets.username;
  const passwordMatches = usernameMatches
    ? await verifyPasswordHash(password, secrets.passwordHash)
    : false;

  if (!usernameMatches || !passwordMatches) {
    return htmlResponse(renderLoginPage({
      errorMessage: "That username or password did not work.",
      nextPath,
      username
    }), 401);
  }

  const sessionToken = await createSessionToken(username, secrets.sessionSecret);
  const csrfToken = await createCsrfToken(username, secrets.csrfSecret);
  const destination = new URL(nextPath, request.url).toString();
  const headers = new Headers({
    location: destination
  });
  headers.append("set-cookie", buildCookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Strict"
  }));
  headers.append("set-cookie", buildCookie(CSRF_COOKIE_NAME, csrfToken, {
    maxAge: SESSION_TTL_SECONDS,
    path: "/owner",
    sameSite: "Strict"
  }));

  return new Response(null, {
    status: 303,
    headers
  });
}

function renderLoginPage(options = {}) {
  const errorMessage = options.errorMessage || "";
  const loggedOut = Boolean(options.loggedOut);
  const nextPath = options.nextPath || "/owner/index.html";
  const username = escapeHtml(options.username || "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Tobacco Road Games Owner Login</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #140f0c;
      color: #f4e2bf;
      font-family: "Trebuchet MS", "Segoe UI", Arial, sans-serif;
    }

    .panel {
      width: min(420px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid rgba(244, 226, 191, 0.18);
      border-radius: 18px;
      background: rgba(12, 8, 6, 0.92);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }

    h1 {
      margin: 0 0 10px;
      font-size: 1.6rem;
    }

    p {
      line-height: 1.6;
    }

    label {
      display: grid;
      gap: 6px;
      margin-top: 12px;
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    input {
      padding: 11px 12px;
      border: 1px solid rgba(244, 226, 191, 0.2);
      border-radius: 10px;
      background: #1d1511;
      color: #f7efe0;
      font: inherit;
    }

    button {
      margin-top: 18px;
      width: 100%;
      padding: 12px 14px;
      border: 0;
      border-radius: 999px;
      background: #d6a24b;
      color: #120d09;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .notice {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(244, 226, 191, 0.08);
    }

    .notice--error {
      background: rgba(164, 39, 39, 0.18);
      color: #ffd4d4;
    }

    .muted {
      color: #d0bea2;
      font-size: 0.94rem;
    }
  </style>
</head>
<body>
  <main class="panel">
    <h1>Owner Login</h1>
    <p class="muted">Sign in to reach the Tobacco Road Games owner tools.</p>
    ${loggedOut ? `<p class="notice">You have been logged out.</p>` : ""}
    ${errorMessage ? `<p class="notice notice--error">${escapeHtml(errorMessage)}</p>` : ""}
    <form method="post" action="/owner/login?next=${encodeURIComponent(nextPath)}">
      <label>
        Username
        <input type="text" name="username" autocomplete="username" value="${username}" required>
      </label>
      <label>
        Password
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Sign In</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function logOwnerLoginException(request, error) {
  const payload = {
    errorMessage: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : "UnknownError",
    event: "owner_login_exception",
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get("cf-ray") || ""
  };

  console.error(JSON.stringify(payload));
}
