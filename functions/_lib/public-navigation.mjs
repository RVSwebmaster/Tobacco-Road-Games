export const PUBLIC_NAV_ITEMS = Object.freeze([
  { key: "store", href: "/store/", label: "Marketplace" },
  { key: "creators", href: "/authors.html", label: "Creators" },
  { key: "releases", href: "/store/#new-releases-bookshelf-heading", label: "New Releases" },
  { key: "sales", href: "/store/catalog/", label: "Sales &amp; Bundles" },
  { key: "goods", href: "/#physical-goods", label: "Physical Goods" },
  { key: "forum", href: "/forum", label: "Community" },
  { key: "about", href: "/#about", label: "About TRG" },
  { key: "account", href: "/account.html", label: "Account / My Library" },
  { key: "cart", href: "/store/cart/", label: "Cart" }
]);

export function renderPublicNavigation(current = "", ariaLabel = "Primary") {
  return `<nav class="site-nav" aria-label="${ariaLabel}">${PUBLIC_NAV_ITEMS.map((item) => `<a href="${item.href}"${current === item.key ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>`;
}
