(() => {
  const nav = document.querySelector("[data-progressive-navigation]");
  if (!nav) return;
  const customerStorefront = document.querySelector("[data-customer-storefront]");

  let libraryItems = [];
  let libraryRefreshTimer = 0;

  fetch("/api/navigation", { credentials: "same-origin", headers: { accept: "application/json" } })
    .then(async (response) => {
      const state = await response.json();
      if (!response.ok) throw new Error(state?.error?.message || "Navigation is unavailable.");
      if (customerStorefront && !state.authenticated) {
        location.replace("/guest/");
        return;
      }
      renderNavigation(state);
      if (state.authenticated) {
        await Promise.allSettled([
          loadLibrary(),
          ...(customerStorefront ? [loadProfileLink()] : [])
        ]);
      }
    })
    .catch(() => {
      // The server-rendered Guest navigation is the fail-closed fallback.
    });

  function renderNavigation(state) {
    const cartCount = nav.querySelector("[data-cart-count]")?.textContent || "0";
    const items = Array.isArray(state.items) ? state.items : [];
    const signedInCustomer = customerStorefront && state.authenticated &&
      Array.isArray(state.levels) && state.levels.includes("customer") &&
      !state.levels.some((level) => ["creator", "admin", "owner"].includes(level));
    nav.replaceChildren(...items.flatMap((item) => {
      if (customerStorefront && item.key === "account" && !signedInCustomer) {
        return [createLogoutButton()];
      }
      const link = document.createElement("a");
      const customerAccount = signedInCustomer && item.key === "account";
      link.href = customerAccount ? "/customer-profile/" : item.href;
      if (new URL(link.href, location.origin).pathname === location.pathname) {
        link.setAttribute("aria-current", "page");
      }
      if (item.key === "cart") {
        link.append("Cart ");
        const badge = document.createElement("span");
        badge.className = "cart-count-badge";
        badge.dataset.cartCount = "";
        badge.textContent = cartCount;
        link.append(badge);
      } else {
        link.textContent = customerAccount ? "Account" : item.label;
      }
      if (customerAccount) return [link, createLogoutButton()];
      return [link];
    }));
    nav.dataset.privilegeLevels = Array.isArray(state.levels) ? state.levels.join(" ") : "guest";
  }

  function createLogoutButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.customerLogout = "";
    button.textContent = "Logout";
    button.addEventListener("click", () => logoutCustomer(button));
    return button;
  }

  async function loadProfileLink() {
    const response = await fetch("/api/account/me", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return;
    const account = await response.json();
    const accountClass = account.user?.accountClass;
    const routes = JSON.parse(nav.dataset.memberProfileRoutes || "{}");
    if (!account.authenticated || !Object.hasOwn(routes, accountClass)) return;

    const link = document.createElement("a");
    link.href = routes[accountClass];
    link.textContent = "Profile";
    nav.querySelector("[data-customer-logout]")?.before(link);
  }

  async function logoutCustomer(button) {
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Logout failed.");
      location.replace("https://tobaccoroadgames.com/");
    } catch {
      button.disabled = false;
      window.alert("Logout could not be completed. Please try again.");
    }
  }

  async function loadLibrary() {
    if (customerStorefront) {
      await loadCustomerLibrary();
      return;
    }
    prepareAuthenticatedGuestLibrary();
    const response = await fetch("/api/account/library", {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return;
    const payload = await response.json();
    libraryItems = Array.isArray(payload.items) ? payload.items : [];
    renderLibrary();
    document.querySelectorAll("[data-personal-library]").forEach((row) => {
      new ResizeObserver(() => {
        clearTimeout(libraryRefreshTimer);
        libraryRefreshTimer = setTimeout(renderLibrary, 40);
      }).observe(row);
    });
  }

  async function loadCustomerLibrary() {
    const response = await fetch("/api/account/library", {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return;
    const payload = await response.json();
    prepareCustomerLibrary();
    renderCustomerLibrary(Array.isArray(payload.items) ? payload.items : []);
  }

  function prepareCustomerLibrary() {
    const bay = document.querySelector("[data-customer-storefront] .guest-library-bay[data-homepage-library]");
    if (!bay) return;
    bay.querySelector(".shop-wall-shelves--library")?.setAttribute("aria-label", "Your personal library shelves");
    bay.querySelectorAll("[data-customer-library-row]").forEach((row) => {
      row.classList.remove("guest-library-empty-row");
      row.removeAttribute("aria-hidden");
      row.querySelector(".guest-library-sign")?.remove();
    });
  }

  function renderCustomerLibrary(items) {
    const rows = Array.from(document.querySelectorAll("[data-customer-storefront] [data-customer-library-row]"));
    const makeBook = openRules?.createOpenRulesShelfBook;
    if (!rows.length || typeof makeBook !== "function") return;
    const visibleItems = items.slice(0, rows.length * 18);
    rows.forEach((row, rowIndex) => {
      const shelfItems = visibleItems.slice(rowIndex * 18, (rowIndex + 1) * 18);
      row.replaceChildren();
      if (!shelfItems.length) return;
      const shelf = document.createElement("div");
      shelf.className = "shop-wall-library-books";
      const shelfWidth = Number(row.getBoundingClientRect?.().width) || 0;
      const viewportWidth = Number(window.innerWidth) || shelfWidth || 800;
      const preferredWidth = Math.min(22, Math.max(11, viewportWidth * 0.0135));
      const baseWidth = shelfWidth > 17 ? Math.min(preferredWidth, (shelfWidth - 17) / 18) : preferredWidth;
      shelfItems.forEach((item, index) => {
        const slug = String(item.productId || "");
        const product = {
          id: slug,
          slug,
          title: String(item.productTitle || "Owned product"),
          creator: String(item.creator || "Tobacco Road Games"),
          cover: String(item.coverImage || "/assets/tobacco-road-games-logo.png"),
          fullUrl: String(item.downloadUrl || "/account.html#library-panel"),
          description: "Owned product in your personal library."
        };
        shelf.append(makeBook(product, rowIndex * 18 + index, baseWidth));
      });
      row.append(shelf);
      document.dispatchEvent(new CustomEvent("trg:homepage-shelves-updated", {
        detail: { shelf: `openRulesLibraryCustomer${rowIndex + 1}`, row: shelf, count: shelfItems.length }
      }));
    });
  }

  function prepareAuthenticatedGuestLibrary() {
    const bay = document.querySelector(".guest-library-bay[data-homepage-library]");
    if (!bay || bay.querySelector("[data-personal-library]")) return;

    const shelves = bay.querySelector(".shop-wall-shelves--library");
    if (shelves) shelves.setAttribute("aria-label", "Your personal library shelves");
    bay.querySelectorAll(".guest-library-empty-row").forEach((row) => {
      row.classList.remove("guest-library-empty-row");
      row.removeAttribute("data-magical-bookshelf");
      row.removeAttribute("data-magical-shelf-order");
      row.removeAttribute("data-magical-direction");
      row.removeAttribute("aria-hidden");
      const books = document.createElement("div");
      books.className = "shop-wall-library-books";
      books.dataset.personalLibrary = "";
      for (let index = 0; index < 18; index += 1) books.append(libraryPlaceholder());
      row.replaceChildren(books);
    });
  }

  function renderLibrary() {
    const rows = Array.from(document.querySelectorAll("[data-personal-library]"));
    if (!rows.length) return;
    const slots = rows.flatMap((row) => Array.from(row.children).slice(1));
    slots.forEach((slot, index) => {
      const item = libraryItems[index];
      if (!item) {
        if (slot.matches("[data-library-item]")) slot.replaceWith(libraryPlaceholder());
        return;
      }
      if (slot.dataset.libraryProductId === String(item.productId || "")) return;
      slot.replaceWith(libraryBook(item));
    });
  }

  function libraryBook(item) {
    const link = document.createElement("a");
    link.className = "shop-wall-product-mock shop-wall-product-mock--spine homepage-library-book";
    link.dataset.libraryItem = "";
    link.dataset.libraryProductId = String(item.productId || "");
    link.href = item.downloadUrl || "/account.html#library-panel";
    link.textContent = String(item.productTitle || "Owned product");
    link.setAttribute("aria-label", `${item.productTitle || "Owned product"} in My Library${item.downloadAvailable ? "; download" : ""}`);
    link.title = [item.productTitle, item.creator ? `by ${item.creator}` : ""].filter(Boolean).join(" ");
    return link;
  }

  function libraryPlaceholder() {
    const placeholder = document.createElement("figure");
    placeholder.className = "shop-wall-product-mock shop-wall-product-mock--spine";
    placeholder.setAttribute("aria-hidden", "true");
    return placeholder;
  }
})();
