const assert = require("node:assert/strict");

async function main() {
  const { resolveMemberProfileAccess } = await import("../functions/_lib/member-profile-access.mjs");
  const classFor = async ({ role = "user", identities = [], capacities = {} }) => resolveMemberProfileAccess({}, { id: "test-user", role }, {
    identityResolver: async () => identities,
    capacityResolver: async (_database, id) => capacities[id] || {}
  });

  assert.deepEqual(await classFor({}), {
    accountClass: "customer", accountClassLabel: "Customer", creatorDashboardAvailable: false
  });
  assert.deepEqual(await classFor({ identities: [{ id: "creator-standard", permission: "manager" }] }), {
    accountClass: "creator", accountClassLabel: "Creator", creatorDashboardAvailable: true
  });
  assert.deepEqual(await classFor({
    identities: [{ id: "creator-founding", permission: "manager" }],
    capacities: { "creator-founding": { founding25: true, preferred: true } }
  }), {
    accountClass: "founding25", accountClassLabel: "Founding-25", creatorDashboardAvailable: true
  });
  assert.deepEqual(await classFor({
    identities: [{ id: "creator-premium", permission: "manager" }],
    capacities: { "creator-premium": { preferred: true } }
  }), {
    accountClass: "premiumCreator", accountClassLabel: "Premium Creator", creatorDashboardAvailable: true
  });
  assert.deepEqual(await classFor({ role: "admin" }), {
    accountClass: "admin", accountClassLabel: "Admin", creatorDashboardAvailable: false
  });
  assert.deepEqual(await classFor({ role: "owner" }), {
    accountClass: "owner", accountClassLabel: "Owner", creatorDashboardAvailable: false
  });
  assert.equal((await classFor({ identities: [{ id: "creator-member", permission: "reader" }] })).creatorDashboardAvailable, false,
    "Read-only Creator membership does not expose Creator Dashboard publishing entry points.");
  console.log("Member Profile account-class resolution tests passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
