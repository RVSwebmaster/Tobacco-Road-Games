(() => {
  const nav = document.querySelector("[data-progressive-navigation]");
  if (!nav) return;

  let libraryItems = [];
  let libraryRefreshTimer = 0;

  fetch("/api/navigation", { credentials: "same-origin", headers: { accept: "application/json" } })
    .then(async (response) => {
      const state = await response.json();
      if (!response.ok) throw new Error(state?.error?.message || "Navigation is unavailable.");
      renderNavigation(state);
      if (state.authenticated) await loadLibrary();
    })
    .catch(() => {
      // The server-rendered Guest navigation is the fail-closed fallback.
    });

  function renderNavigation(state) {
    const cartCount = nav.querySelector("[data-cart-count]")?.textContent || "0";
    const items = Array.isArray(state.items) ? state.items : [];
    const homepageItems = items.filter((item) => item.key !== "ai-policy");
    nav.replaceChildren(...homepageItems.map((item) => {
      const link = document.createElement("a");
      link.href = item.href;
      if (item.key === "cart") {
        link.append("Cart ");
        const badge = document.createElement("span");
        badge.className = "cart-count-badge";
        badge.dataset.cartCount = "";
        badge.textContent = cartCount;
        link.append(badge);
      } else {
        link.textContent = item.label;
      }
      return link;
    }));
    nav.dataset.privilegeLevels = Array.isArray(state.levels) ? state.levels.join(" ") : "guest";
  }

  async function loadLibrary() {
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
