(() => {
  const root = document.querySelector("[data-customer-membership]");
  if (!root) return;

  const status = root.querySelector("[data-membership-status]");
  const setText = (selector, value, fallback = "Unavailable") => {
    const node = root.querySelector(selector);
    if (node) node.textContent = value || fallback;
  };
  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)
      : "Unavailable";
  };

  async function loadDashboard() {
    const [meResponse, profileResponse, libraryResponse] = await Promise.all([
      fetch("/api/account/me", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
      fetch("/api/account/profile", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } }),
      fetch("/api/account/library", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
    ]);
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
    const privateUser = profile?.user || {};
    setText("[data-membership-display-name]", member.displayName);
    setText("[data-membership-real-name]", privateUser.legalName);
    setText("[data-membership-email]", member.email);
    setText("[data-membership-status-value]", member.status);
    setText("[data-membership-joined]", formatDate(member.createdAt));
    const payment = privateUser.paymentMethod;
    setText("[data-membership-billing]", payment?.status === "ready"
      ? `${payment.brand || "Card"} ending in ${payment.last4 || "••••"}`
      : payment?.status === "missing" ? "No saved payment method" : "Billing status unavailable");
    setText("[data-membership-notices]", typeof privateUser.notificationPreferences?.accountNotices === "boolean"
      ? (privateUser.notificationPreferences.accountNotices ? "On" : "Off")
      : "Not set");
    showAvatar(privateUser.avatarUrl, member.displayName);
    renderLibrary(Array.isArray(library?.items) ? library.items : []);
    if (status) status.textContent = "Your Customer membership information is up to date.";
  }

  function showAvatar(url, displayName) {
    const image = root.querySelector("[data-membership-avatar]");
    const placeholder = root.querySelector("[data-membership-avatar-empty]");
    if (!image || !placeholder || !url) return;
    image.alt = `${displayName || "Member"} profile image`;
    image.onload = () => { image.hidden = false; placeholder.hidden = true; };
    image.onerror = () => { image.hidden = true; placeholder.hidden = false; };
    image.src = url;
  }

  function renderLibrary(items) {
    const libraryStatus = root.querySelector("[data-membership-library-status]");
    const libraryList = root.querySelector("[data-membership-library]");
    if (!libraryList || !libraryStatus) return;
    if (!items.length) {
      libraryStatus.textContent = "No purchased products are in your library yet.";
      return;
    }

    const libraryRows = [];
    for (const item of items) {
      const row = document.createElement("li");
      row.append(document.createTextNode(String(item.productTitle || "Purchased product")));
      if (item.downloadUrl && item.downloadAvailable) {
        const link = document.createElement("a");
        link.href = item.downloadUrl;
        link.textContent = "Download";
        row.append(" · ", link);
      }
      if (item.currentLastUpdated && item.purchasedLastUpdated && item.currentLastUpdated !== item.purchasedLastUpdated) {
        row.append(document.createTextNode(" · Product updated"));
      }
      libraryRows.push(row);
    }

    libraryStatus.textContent = `${items.length} purchased ${items.length === 1 ? "product" : "products"} in your library.`;
    libraryList.replaceChildren(...libraryRows.slice(0, 5));
  }

  root.querySelector("[data-membership-signout]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Sign out failed.");
      location.replace("/account.html");
    } catch {
      button.disabled = false;
      if (status) status.textContent = "Sign out could not be completed. Please try again.";
    }
  });

  loadDashboard().catch(() => {
    if (status) status.textContent = "Some membership information could not be loaded. Try your Account page for help.";
    for (const selector of ["[data-membership-display-name]", "[data-membership-real-name]", "[data-membership-email]", "[data-membership-billing]", "[data-membership-status-value]", "[data-membership-joined]", "[data-membership-notices]"]) {
      setText(selector, "Unavailable");
    }
    setText("[data-membership-library-status]", "Your library is unavailable right now.");
  });
})();
