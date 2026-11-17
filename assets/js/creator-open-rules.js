(() => {
  const rows = Array.from(document.querySelectorAll("[data-creator-library-books]"));
  const renderer = window.TRGOpenRulesLibrary?.createOpenRulesShelfBook;
  if (!rows.length || typeof renderer !== "function") return;

  const MOCK_BOOKS = Object.freeze([
    { slug: "creator-preview-copper-road", title: "Preview: The Copper Road", cover: "/assets/releases/thiefcraft-cover.png", pageCount: 88 },
    { slug: "creator-preview-ashen-kingdom", title: "Preview: The Ashen Kingdom", cover: "/assets/releases/ringbound-cover.webp", pageCount: 142 },
    { slug: "creator-preview-wild-march", title: "Preview: The Wild March", cover: "/assets/products/spriggans/cover.webp", pageCount: 106 },
    { slug: "creator-preview-storm-atlas", title: "Preview: Storm Atlas", cover: "/assets/releases/thiefcraft-cover.png", pageCount: 173 },
    { slug: "creator-preview-quiet-vale", title: "Preview: The Quiet Vale", cover: "/assets/releases/ringbound-cover.webp", pageCount: 96 }
  ]);

  const preferredWidth = () => Math.min(22, Math.max(11, (Number(window.innerWidth) || 800) * 0.0135));

  function render(items, { mock = false } = {}) {
    const visibleItems = items.slice(0, rows.length * 18);
    rows.forEach((row, rowIndex) => {
      const shelfItems = visibleItems.slice(rowIndex * 18, (rowIndex + 1) * 18);
      row.replaceChildren();
      if (!shelfItems.length) return;
      const books = document.createElement("div");
      books.className = "shop-wall-library-books";
      const rowWidth = Number(row.getBoundingClientRect?.().width) || 0;
      const baseWidth = rowWidth > 17 ? Math.min(preferredWidth(), (rowWidth - 17) / 18) : preferredWidth();
      books.style.setProperty("--library-bookstop-clearance", `${Math.max(0, Number.parseFloat(getComputedStyle(row, "::before").width) || 0) * 6}px`);
      shelfItems.forEach((item, index) => {
        const slug = String(item.productId || item.slug || "");
        const title = String(item.productTitle || item.title || "Owned product");
        const product = {
          id: slug,
          slug,
          title,
          creator: String(item.creator || "Tobacco Road Games"),
          description: mock ? "Owner-only visual preview. This mock book is not a product or entitlement." : "Purchased product in your personal library.",
          cover: String(item.coverImage || item.coverUrl || item.cover || "/assets/tobacco-road-games-logo.png"),
          fullUrl: mock ? "#creator-preview-only" : String(item.detailUrl || item.downloadUrl || `/store/products/${encodeURIComponent(slug)}/`),
          metadata: mock ? { pageCount: item.pageCount } : (item.metadata || {})
        };
        const book = renderer(product, rowIndex * 18 + index, baseWidth);
        if (mock) {
          book.dataset.creatorPreviewOnly = "";
          book.setAttribute("aria-label", `${title}. Owner-only mock preview; no product or purchase is attached.`);
          book.title = `${title} — Owner-only visual preview`;
        } else {
          book.dataset.creatorOwnedBook = "";
          book.setAttribute("aria-label", `Examine ${title}; activate again to open the product page.`);
        }
        books.append(book);
      });
      row.append(books);
    });
    document.dispatchEvent(new CustomEvent("trg:creator-library-updated"));
  }

  async function load() {
    let account;
    try {
      const response = await fetch("/api/account/me", { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return;
      account = await response.json();
    } catch { return; }

    const previewRequested = new URLSearchParams(window.location.search).get("preview-library") === "1";
    if (previewRequested && account?.authenticated === true && account?.user?.role === "owner") {
      document.documentElement.dataset.creatorLibraryPreview = "owner";
      render(MOCK_BOOKS, { mock: true });
      return;
    }
    if (account?.authenticated !== true) return;

    try {
      const response = await fetch("/api/account/library", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!Array.isArray(payload?.items)) return;
      render(payload.items);
    } catch {
      // Keep the personal shelf empty when ownership data cannot be loaded.
    }
  }

  load();
})();
