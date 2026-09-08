async function rows(statement) {
  const result = await statement.all();
  return result.results || [];
}

export async function listOwnedCreatorIdentities(db, userId) {
  return rows(
    db
      .prepare(
        "SELECT c.*,o.identity_type,o.account_status FROM creator_identity_ownership o JOIN marketplace_creators c ON c.id=o.creator_id WHERE o.owner_user_id=? ORDER BY CASE o.identity_type WHEN 'primary' THEN 0 ELSE 1 END,c.display_name,c.id",
      )
      .bind(userId),
  );
}

export async function listCreatorMembershipIdentities(db, userId) {
  return rows(
    db
      .prepare(
        "SELECT c.*,cm.permission,cm.user_id FROM creator_memberships cm JOIN marketplace_creators c ON c.id=cm.creator_id WHERE cm.user_id=? ORDER BY c.display_name,c.id",
      )
      .bind(userId),
  );
}

export function selectCreatorIdentity(identities, requestedCreator = "") {
  const requested = String(requestedCreator || "").trim();
  if (requested)
    return (
      identities.find(
        (creator) => creator.id === requested || creator.slug === requested,
      ) || null
    );
  return identities.length === 1 ? identities[0] : null;
}

export async function resolveOwnedCreatorIdentity(
  db,
  { userId, requestedCreator } = {},
) {
  const identities = await listOwnedCreatorIdentities(db, userId);
  return {
    creator: selectCreatorIdentity(identities, requestedCreator),
    identities,
    ambiguous: !requestedCreator && identities.length > 1,
  };
}

export async function resolveCreatorMembershipIdentity(
  db,
  { userId, requestedCreator } = {},
) {
  const identities = await listCreatorMembershipIdentities(db, userId);
  return {
    creator: selectCreatorIdentity(identities, requestedCreator),
    identities,
    ambiguous: !requestedCreator && identities.length > 1,
  };
}
