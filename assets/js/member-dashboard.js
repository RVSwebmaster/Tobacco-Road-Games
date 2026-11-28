(() => {
  const root = document.querySelector("[data-member-dashboard]");
  if (!root) return;
  const status = root.querySelector("[data-dashboard-status]");
  const text = (selector, value, fallback = "Not provided") => {
    const node = root.querySelector(selector);
    if (node) node.textContent = value || fallback;
  };
  const dashboardPages = [
    { key: "overview", label: "Overview", href: "/dashboard/", tier: "customer" }
  ];
  const tiers = ["customer", "creator", "premiumCreator", "founding25", "owner"];
  const dateLabel = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)
      : "Unavailable";
  };

  Promise.all([
    fetch("/api/account/me", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
    fetch("/api/account/profile", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
    fetch("/api/account/library", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
  ]).then(async ([meResponse, profileResponse, libraryResponse]) => {
    if (meResponse.status === 401 || profileResponse.status === 401 || libraryResponse.status === 401) {
      location.replace("/account.html");
      return;
    }
    const [me, profile, library] = await Promise.all([
      meResponse.ok ? meResponse.json() : null,
      profileResponse.ok ? profileResponse.json() : null,
      libraryResponse.ok ? libraryResponse.json() : null
    ]);
    if (!me?.authenticated || !me.user) {
      location.replace("/account.html");
      return;
    }
    const member = me.user;
    renderPages(member.accountClass);
    const privateUser = profile?.user || {};
    text("[data-dashboard-display-name]", member.displayName);
    text("[data-dashboard-real-name]", privateUser.legalName);
    text("[data-dashboard-email]", member.email, "Email unavailable");
    const payment = privateUser.paymentMethod;
    text("[data-dashboard-billing]", payment?.status === "ready"
      ? `${payment.brand || "Card"} ending in ${payment.last4 || "••••"}`
      : payment?.status === "missing" ? "No saved payment method" : "Billing status unavailable");
    const tierLabel = member.accountClass === "premiumCreator" ? "Premier Creator" : member.accountClassLabel || "Member";
    text("[data-dashboard-tier]", tierLabel);
    text("[data-dashboard-member-status]", member.status || "Status unavailable");
    text("[data-dashboard-joined]", dateLabel(member.createdAt));

    const items = Array.isArray(library?.items) ? library.items : [];
    const list = root.querySelector("[data-dashboard-library]");
    const libraryStatus = root.querySelector("[data-dashboard-library-status]");
    if (list && libraryStatus) {
      libraryStatus.textContent = items.length
        ? `${items.length} purchased ${items.length === 1 ? "title" : "titles"} in your library.`
        : "No purchased titles are in your library yet.";
      list.replaceChildren(...items.slice(0, 5).map((item) => {
        const li = document.createElement("li");
        const title = document.createElement("span");
        title.textContent = String(item.productTitle || "Purchased title");
        li.append(title);
        if (item.downloadUrl && item.downloadAvailable) {
          const link = document.createElement("a");
          link.href = item.downloadUrl;
          link.textContent = "Download";
          li.append(" · ", link);
        }
        if (item.currentLastUpdated && item.purchasedLastUpdated && item.currentLastUpdated !== item.purchasedLastUpdated) {
          const update = document.createElement("span");
          update.textContent = " · Product updated";
          li.append(update);
        }
        return li;
      }));
    }
    if (status) status.textContent = "Dashboard loaded.";
  }).catch(() => {
    if (status) status.textContent = "Some dashboard information could not be loaded. Try your Account page for help.";
    text("[data-dashboard-display-name]", "Unavailable");
    text("[data-dashboard-real-name]", "Unavailable");
    text("[data-dashboard-email]", "Unavailable");
    text("[data-dashboard-billing]", "Unavailable");
    text("[data-dashboard-tier]", "Unavailable");
    text("[data-dashboard-member-status]", "Unavailable");
    text("[data-dashboard-joined]", "Unavailable");
  });

  function renderPages(accountClass) {
    const nav = root.querySelector("[data-dashboard-pages]");
    if (!nav) return;
    const memberTier = tiers.indexOf(accountClass);
    const pages = dashboardPages.filter((page) => memberTier >= tiers.indexOf(page.tier));
    nav.replaceChildren(...pages.map((page) => {
      const link = document.createElement("a");
      link.href = page.href;
      link.textContent = page.label;
      if (location.pathname === page.href || `${location.pathname}/` === page.href) link.setAttribute("aria-current", "page");
      return link;
    }));
  }
})();
