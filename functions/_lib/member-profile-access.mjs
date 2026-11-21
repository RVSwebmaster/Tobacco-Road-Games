import { getCreatorTier } from "./marketplace-policy.mjs";
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
  { identityResolver = listCreatorMembershipIdentities, capacityResolver = readProfileTier } = {},
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

// Resolve display identity independently from marketplace commission and capacity policy.
async function readProfileTier(database, creatorId) {
  const now = new Date().toISOString();
  const founding = await database.prepare(
    "SELECT 1 AS active FROM creator_commission_category_assignments WHERE creator_id=? AND category='founding25' AND effective_at<=? AND (revoked_at IS NULL OR revoked_at>?) LIMIT 1"
  ).bind(creatorId, now, now).first();
  if (founding) return { founding25: true };
  return getCreatorTier(database, creatorId);
}
