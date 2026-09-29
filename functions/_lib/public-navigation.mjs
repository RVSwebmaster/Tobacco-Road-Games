export const PUBLIC_NAV_ITEMS = Object.freeze([
  { key: "explore", href: "/store/catalog/", label: "Explore" },
  { key: "forum", href: "/forum", label: "Community Forum" },
  { key: "creators", href: "/authors.html", label: "Creators" },
  { key: "creator-login", href: "/creator/", label: "Creator Login / Sign Up" },
  { key: "ai-policy", href: "/ai-policy.html", label: "AI Policy" },
  { key: "support", href: "/support.html", label: "Support" },
  { key: "account", href: "/account.html", label: "Join / Sign In" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]);

export function renderPublicNavigation(current = "", ariaLabel = "Primary") {
  return `<nav class="site-nav" aria-label="${ariaLabel}">${PUBLIC_NAV_ITEMS.map((item) => `<a href="${item.href}"${current === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>`;
}
