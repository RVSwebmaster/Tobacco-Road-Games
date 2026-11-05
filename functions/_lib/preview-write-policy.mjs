const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isMarketplaceWriteDisabled(env = {}, request = {}) {
  const policy = String(env.MARKETPLACE_WRITE_POLICY || "").trim().toLowerCase();
  const method = String(request.method || "GET").trim().toUpperCase();
  return policy === "disabled" && !READ_ONLY_METHODS.has(method);
}

export function marketplaceWriteDisabledResponse() {
  return Response.json({
    error: "This preview is read-only. Marketplace changes and external operations are disabled."
  }, {
    headers: { "cache-control": "no-store" },
    status: 503
  });
}
