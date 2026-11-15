(() => {
  const PRODUCT_IDS = Object.freeze([
    "5e-players-manual",
    "5e-spellbook",
    "5e-bard-spellbook",
    "5e-cleric-spellbook",
    "5e-druid-spellbook",
    "5e-paladin-spellbook",
    "5e-ranger-spellbook",
    "5e-sorcerer-spellbook",
    "5e-warlock-spellbook",
    "5e-wizard-spellbook",
    "5e-relics-and-wonders",
    "5e-dungeon-masters-handbook",
    "5e-monster-guide"
  ]);

  const normalizeProduct = (product) => ({
    id: product.id,
    slug: product.slug,
    title: product.title,
    creator: product.creatorName || "Tobacco Road Games",
    description: product.shortDescription || "",
    cover: product.coverUrl || "",
    fullUrl: product.detailUrl || `/store/products/${encodeURIComponent(product.slug)}/`,
    priceLabel: product.purchaseAvailability || "Preview Only",
    metadata: product.metadata || {}
  });

  const load = async () => {
    const bay = document.querySelector(".creator-dashboard-open-rules-bay");
    if (!bay || !window.TRGHomepageShelves?.hydrateOpenRulesLibrary) return;

    if (!bay.dataset.creatorOpenRulesHoverBound) {
      bay.addEventListener("pointerover", (event) => {
        const book = event.target.closest(".shop-wall-library-books a");
        if (book && bay.contains(book)) book.classList.add("creator-open-rules-book-hovered");
      });
      bay.addEventListener("pointerout", (event) => {
        const book = event.target.closest(".shop-wall-library-books a");
        if (book && bay.contains(book) && !book.contains(event.relatedTarget)) {
          book.classList.remove("creator-open-rules-book-hovered");
        }
      });
      bay.dataset.creatorOpenRulesHoverBound = "true";
    }

    const measureBookstopClearance = () => {
      bay.querySelectorAll("[data-creator-open-rules-books]").forEach((books) => {
        const row = books.parentElement;
        const spineWidth = Number.parseFloat(getComputedStyle(row, "::after").width);
        if (Number.isFinite(spineWidth) && spineWidth > 0) {
          books.style.setProperty("--library-bookstop-clearance", `${spineWidth * 6}px`);
        }
      });
    };
    measureBookstopClearance();

    const products = (await Promise.all(PRODUCT_IDS.map(async (id) => {
      const response = await fetch(`/api/catalog?slug=${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.product ? normalizeProduct(payload.product) : null;
    }))).filter(Boolean);

    window.TRGHomepageShelves.hydrateOpenRulesLibrary(
      { managed: true, visible: true, products },
      { managed: true, visible: true, products: [] }
    );
    measureBookstopClearance();
    bay.querySelectorAll(".shop-wall-shelf-level").forEach((level) => {
      if (typeof ResizeObserver === "function") new ResizeObserver(measureBookstopClearance).observe(level);
    });
    bay.dataset.creatorOpenRulesCount = String(products.length);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
