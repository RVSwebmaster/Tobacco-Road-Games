import { getCreatorCapacity } from "./marketplace-policy.mjs";
import { listCreatorMembershipIdentities } from "./creator-identity-selection.mjs";

const ACCOUNT_CLASS_LABELS = Object.freeze({
  customer: "Customer",
  creator: "Creator",
  founding25: "Founding-25",
  premiumCreator: "Premium Creator",
  admin: "Admin",
  owner: "Owner",
});

export async function resolveMemberProfileAccess(
  database,
  user,
  { identityResolver = listCreatorMembershipIdentities, capacityResolver = getCreatorCapacity } = {},
) {
  const role = String(user?.role || "").toLowerCase();
  let identities = [];
  try {
    identities = await identityResolver(database, user.id);
  } catch {
    // Account identity remains available if marketplace membership tables are
    // not present in a local or migration-incomplete environment.
  }

  if (role === "owner" || role === "admin") {
    return {
      accountClass: role,
      accountClassLabel: ACCOUNT_CLASS_LABELS[role],
      creatorDashboardAvailable: identities.some((identity) => identity.permission === "manager"),
    };
  }

  let accountClass = identities.length ? "creator" : "customer";
  for (const identity of identities) {
    try {
      const capacity = await capacityResolver(database, identity.id);
      if (capacity.founding25) {
        accountClass = "founding25";
        break;
      }
      if (capacity.preferred) accountClass = "premiumCreator";
    } catch {
      // Tier lookup failures do not grant an elevated class.
    }
  }

  return {
    accountClass,
    accountClassLabel: ACCOUNT_CLASS_LABELS[accountClass],
    creatorDashboardAvailable: identities.some((identity) => identity.permission === "manager"),
  };
}
