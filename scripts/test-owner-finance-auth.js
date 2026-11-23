const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const { authorizeOwnerFinanceRequest } = await import(pathToFileURL(
    path.join(ROOT, "functions", "_lib", "owner-finance-auth.mjs"),
  ).href);
  const get = (role, status = "active", membership = "customer") => authorizeOwnerFinanceRequest(
    new Request("https://trg.example/owner/api/finance"),
    {},
    { getSession: async () => role ? { valid: true, user: { id: role, role, status, membership } } : { valid: false } },
  );

  let result = await get(null);
  assert.equal(result.response.status, 401, "Anonymous finance access must be rejected.");
  result = await get("user", "active", "customer");
  assert.equal(result.response.status, 403, "Customer finance access must be rejected.");
  result = await get("user", "active", "creator"); // Creator accounts retain the ordinary `user` auth role.
  assert.equal(result.response.status, 403, "Creator finance access must be rejected.");
  for (const role of ["admin", "owner"]) {
    result = await get(role);
    assert.equal(result.response, undefined, `An active ${role} must pass the finance authorization gate.`);
    assert.equal(result.session.user.role, role);
  }
  result = await get("admin", "disabled");
  assert.equal(result.response.status, 403, "A disabled administrative identity must be rejected.");

  const admin = { valid: true, user: { id: "admin-1", role: "admin", status: "active" } };
  result = await authorizeOwnerFinanceRequest(
    new Request("https://trg.example/owner/api/finance", { method: "POST", headers: { origin: "https://trg.example" } }),
    {},
    {
      getSession: async () => admin,
      validateOrigin: () => true,
      validateCsrf: async () => ({ valid: true }),
    },
  );
  assert.equal(result.response, undefined, "An authorized Admin with a valid same-origin CSRF check may post.");
  result = await authorizeOwnerFinanceRequest(
    new Request("https://trg.example/owner/api/finance", { method: "POST" }),
    {},
    {
      getSession: async () => admin,
      validateOrigin: () => true,
      validateCsrf: async () => ({ valid: false }),
    },
  );
  assert.equal(result.response.status, 403, "Finance mutations must require CSRF validation.");

  const financeRoute = fs.readFileSync(path.join(ROOT, "functions", "owner", "api", "finance.js"), "utf8");
  const creatorFinance = fs.readFileSync(path.join(ROOT, "functions", "_lib", "creator-finance-owner.mjs"), "utf8");
  assert.match(financeRoute, /authorizeOwnerFinanceRequest\(request, env\)/);
  assert.match(creatorFinance, /authorizeOwnerFinanceRequest\(request, env, options\)/);
  assert.match(creatorFinance, /const actorId = authorization\.session\.user\.id/);
  console.log("Owner finance authorization tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
