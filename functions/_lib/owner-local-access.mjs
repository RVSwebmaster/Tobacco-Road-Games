const LOCAL_OWNER_SUBJECT = "rv-local-owner";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function getLocalOwnerAccessState(request, env = {}) {
  if (String(env.LOCAL_OWNER_BYPASS || "").trim() !== "1") {
    return { valid: false, reason: "disabled" };
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return { valid: false, reason: "invalid_url" };
  }

  if (!isLoopbackHost(requestUrl.hostname)) {
    return { valid: false, reason: "non_loopback_host" };
  }

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  if (forwardedHost && !isLoopbackHost(stripPort(forwardedHost))) {
    return { valid: false, reason: "non_loopback_forwarded_host" };
  }

  const connectingIp = firstForwardedValue(request.headers.get("cf-connecting-ip"));
  if (connectingIp && !isLoopbackHost(stripBrackets(connectingIp))) {
    return { valid: false, reason: "non_loopback_client" };
  }

  return {
    csrfSubject: LOCAL_OWNER_SUBJECT,
    email: "",
    localBypass: true,
    username: LOCAL_OWNER_SUBJECT,
    valid: true
  };
}

export function isLocalOwnerAccessRequest(request, env = {}) {
  return getLocalOwnerAccessState(request, env).valid;
}

function firstForwardedValue(value) {
  return String(value || "").split(",")[0].trim();
}

function isLoopbackHost(value) {
  return LOOPBACK_HOSTS.has(String(value || "").trim().toLowerCase());
}

function stripBrackets(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function stripPort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closingBracket = normalized.indexOf("]");
    return closingBracket === -1 ? normalized : normalized.slice(0, closingBracket + 1);
  }
  return normalized.replace(/:\d+$/, "");
}
