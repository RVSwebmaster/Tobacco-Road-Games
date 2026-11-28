export const PUBLIC_NAV_ITEMS = Object.freeze([
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "support", href: "/support.html", label: "Support" },
  { key: "account", href: "/account.html", label: "Login/Signup" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]);

export function buildProgressiveNavigation({ authenticated = false, creator = false, role = "user" } = {}) {
  const normalizedRole = ["admin", "owner"].includes(role) ? role : "user";
  const creatorAccess = creator || ["admin", "owner"].includes(normalizedRole);
  const levels = ["guest"];
  const items = PUBLIC_NAV_ITEMS.map((item) => ({ ...item }));
  if (!authenticated) return { authenticated: false, items, levels };

  levels.push("customer");
  if (creatorAccess) levels.push("creator");
  if (["admin", "owner"].includes(normalizedRole)) levels.push("admin");
  if (normalizedRole === "owner") levels.push("owner");
  const memberItems = items.filter((item) => item.key !== "account");
  memberItems.splice(2, 0, { key: "member", label: "Member" });
  return { authenticated: true, items: memberItems, levels };
}

export function renderPublicNavigation(current = "", ariaLabel = "Primary") {
  return `<nav class="site-nav" aria-label="${ariaLabel}">${PUBLIC_NAV_ITEMS.map((item) => `<a href="${item.href}"${current === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>`;
}
