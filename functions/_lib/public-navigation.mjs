export const PUBLIC_NAV_ITEMS = Object.freeze([
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "forum", href: "/forum", label: "Community Forum" },
  { key: "creators", href: "/authors.html", label: "Creators" },
  { key: "ai-policy", href: "/ai-policy.html", label: "AI Policy" },
  { key: "support", href: "/support.html", label: "Support" },
  { key: "account", href: "/account.html", label: "Join / Sign In" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]);

const CUSTOMER_NAV_ITEMS = Object.freeze([
  { key: "library", href: "/account.html#library-panel", label: "My Library" }
]);
const CREATOR_NAV_ITEMS = Object.freeze([
  { key: "creator-studio", href: "/creator/", label: "Creator Studio" }
]);
const ADMIN_NAV_ITEMS = Object.freeze([
  { key: "moderation", href: "/forum/moderation", label: "Forum Moderation" }
]);
const OWNER_NAV_ITEMS = Object.freeze([
  { key: "owner-office", href: "/owner/", label: "Owner Office" }
]);

export function buildProgressiveNavigation({ authenticated = false, creator = false, role = "user" } = {}) {
  const normalizedRole = ["admin", "owner"].includes(role) ? role : "user";
  const creatorAccess = creator || ["admin", "owner"].includes(normalizedRole);
  const levels = ["guest"];
  const items = PUBLIC_NAV_ITEMS.map((item) => ({ ...item }));
  if (!authenticated) return { authenticated: false, items, levels };

  levels.push("customer");
  replaceItem(items, "account", { key: "account", href: "/account.html", label: "My Account" });
  insertBefore(items, "ai-policy", [creatorAccess
    ? CREATOR_NAV_ITEMS[0]
    : { key: "creator-registration", href: "/account.html#creator-registration-panel", label: "Become a Creator" }]);
  insertBefore(items, "cart", CUSTOMER_NAV_ITEMS);

  // Site privileges are cumulative. A membership-backed Creator receives Creator
  // Studio, while Admin and Owner roles also retain every lower navigation tier.
  if (creatorAccess) levels.push("creator");
  if (["admin", "owner"].includes(normalizedRole)) {
    levels.push("admin");
    insertBefore(items, "cart", ADMIN_NAV_ITEMS);
  }
  if (normalizedRole === "owner") {
    levels.push("owner");
    insertBefore(items, "cart", OWNER_NAV_ITEMS);
  }
  return { authenticated: true, items, levels };
}

export function renderPublicNavigation(current = "", ariaLabel = "Primary") {
  return `<nav class="site-nav" aria-label="${ariaLabel}">${PUBLIC_NAV_ITEMS.map((item) => `<a href="${item.href}"${current === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>`;
}

function replaceItem(items, key, replacement) {
  const index = items.findIndex((item) => item.key === key);
  if (index >= 0) items.splice(index, 1, replacement);
}

function insertBefore(items, key, additions) {
  const existing = new Set(items.map((item) => item.key));
  const next = additions.filter((item) => !existing.has(item.key));
  const index = items.findIndex((item) => item.key === key);
  items.splice(index < 0 ? items.length : index, 0, ...next);
}
