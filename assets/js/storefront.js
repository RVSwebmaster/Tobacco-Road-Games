(() => {
  const browsers = Array.from(document.querySelectorAll("[data-store-browser]"));
  const shelves = Array.from(document.querySelectorAll(".bookshelf-grid"));
  const compactCatalogQuery = window.matchMedia("(max-width: 980px), (hover: none)");
  let shelfRefreshTimer = 0;

  if (!browsers.length && !shelves.length) {
    return;
  }

  const getBooksByRow = (shelf) => {
    const items = Array.from(shelf.querySelectorAll(".bookshelf-book:not([hidden])"));
    const rows = new Map();

    items.forEach((item) => {
      const rowKey = String(Math.round(item.offsetTop));

      if (!rows.has(rowKey)) {
        rows.set(rowKey, []);
      }

      rows.get(rowKey).push(item);
    });

    return Array.from(rows.values()).map((rowItems) => {
      return rowItems.sort((left, right) => left.offsetLeft - right.offsetLeft);
    });
  };

  const refreshShelfEdges = () => {
    const targets = Array.from(document.querySelectorAll(".bookshelf-grid"));

    targets.forEach((shelf) => {
      const rows = getBooksByRow(shelf);

      shelf.querySelectorAll(".bookshelf-book").forEach((item) => {
        item.classList.remove("bookshelf-book--edge-right");
      });

      rows.forEach((rowItems) => {
        const autoEdgeCandidates = rowItems.filter((item) => item.dataset.bookshelfForceRight !== "true");

        if (!autoEdgeCandidates.length) {
          return;
        }

        const rightmost = autoEdgeCandidates.reduce((candidate, item) => {
          return item.offsetLeft > candidate.offsetLeft ? item : candidate;
        }, autoEdgeCandidates[0]);

        rightmost.classList.add("bookshelf-book--edge-right");
      });
    });
  };

  const scheduleShelfEdgeRefresh = () => {
    if (shelfRefreshTimer) {
      clearTimeout(shelfRefreshTimer);
    }

    shelfRefreshTimer = window.setTimeout(() => {
      shelfRefreshTimer = 0;
      refreshShelfEdges();
    }, 0);
  };

  const normalizePrice = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
  };

  const matchesFilters = (item, state) => {
    const searchText = item.dataset.search || "";
    const authors = (item.dataset.author || "").split("|").filter(Boolean);
    const formats = (item.dataset.format || "").split("|").filter(Boolean);

    const matchesQuery = !state.query || searchText.includes(state.query);
    const matchesAuthor = !state.author || authors.includes(state.author);
    const matchesSystem = !state.system || item.dataset.system === state.system;
    const matchesLine = !state.line || item.dataset.line === state.line;
    const matchesSeries = !state.series || item.dataset.series === state.series;
    const matchesStatus = !state.status || item.dataset.status === state.status;
    const matchesFormat = !state.format || formats.includes(state.format);
    const matchesPriceType = !state.priceType || item.dataset.priceType === state.priceType;
    const matchesSale = !state.saleOnly || item.dataset.saleActive === "true";

    return matchesQuery
      && matchesAuthor
      && matchesSystem
      && matchesLine
      && matchesSeries
      && matchesStatus
      && matchesFormat
      && matchesPriceType
      && matchesSale;
  };

  const sortItems = (items, sortMode) => {
    return [...items].sort((left, right) => {
      if (sortMode === "newest") {
        return Number(right.dataset.release || 0) - Number(left.dataset.release || 0);
      }

      if (sortMode === "updated") {
        return Number(right.dataset.updated || 0) - Number(left.dataset.updated || 0);
      }

      if (sortMode === "price-low") {
        return normalizePrice(left.dataset.priceCents) - normalizePrice(right.dataset.priceCents);
      }

      if (sortMode === "price-high") {
        return normalizePrice(right.dataset.priceCents) - normalizePrice(left.dataset.priceCents);
      }

      return (left.dataset.title || "").localeCompare(right.dataset.title || "");
    });
  };

  const collectState = (root) => ({
    query: (root.querySelector("[data-filter-search]")?.value || "").trim().toLowerCase(),
    author: root.querySelector("[data-filter-author]")?.value || "",
    system: root.querySelector("[data-filter-system]")?.value || "",
    line: root.querySelector("[data-filter-line]")?.value || "",
    series: root.querySelector("[data-filter-series]")?.value || "",
    status: root.querySelector("[data-filter-status]")?.value || "",
    format: root.querySelector("[data-filter-format]")?.value || "",
    priceType: root.querySelector("[data-filter-price-type]")?.value || "",
    sortMode: root.querySelector("[data-filter-sort]")?.value || "title",
    saleOnly: Boolean(root.querySelector("[data-filter-sale]")?.checked)
  });

  const getAvailableViews = (root) => {
    const views = [];

    if (root.querySelector("[data-store-shelf]")) {
      views.push("shelf");
    }

    if (root.querySelector("[data-store-grid]")) {
      views.push("catalog");
    }

    return views;
  };

  const getDefaultView = (root) => {
    const views = getAvailableViews(root);

    if (!views.includes("shelf")) {
      return "catalog";
    }

    return compactCatalogQuery.matches ? "catalog" : "shelf";
  };

  const setBrowserView = (root, requestedView) => {
    const views = getAvailableViews(root);
    const nextView = views.includes(requestedView) ? requestedView : getDefaultView(root);

    root.dataset.storeView = nextView;

    root.querySelectorAll("[data-store-view-button]").forEach((button) => {
      const isActive = button.dataset.storeViewButton === nextView;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  };

  const syncResponsiveBrowserViews = () => {
    browsers.forEach((root) => {
      if (root.dataset.storeViewLocked === "true") {
        return;
      }

      setBrowserView(root, getDefaultView(root));
    });
  };

  const applyBrowser = (root) => {
    const state = collectState(root);
    const shelf = root.querySelector("[data-store-shelf]");
    const grid = root.querySelector("[data-store-grid]");
    const count = root.querySelector("[data-store-count]");
    const empty = root.querySelector("[data-store-empty]");
    const shelfItems = shelf ? Array.from(shelf.querySelectorAll("[data-product-card]")) : [];
    const gridItems = grid ? Array.from(grid.querySelectorAll("[data-product-card]")) : [];
    const sortedGridItems = sortItems(gridItems.filter((item) => matchesFilters(item, state)), state.sortMode);
    const visibleSlugs = new Set(sortedGridItems.map((item) => item.dataset.slug));

    if (shelf) {
      const sortedShelfItems = sortItems(shelfItems.filter((item) => visibleSlugs.has(item.dataset.slug)), state.sortMode);
      shelfItems.forEach((item) => {
        item.hidden = !visibleSlugs.has(item.dataset.slug);
      });
      shelf.replaceChildren();
      for (let index = 0; index < sortedShelfItems.length; index += 10) {
        const row = document.createElement("div");
        row.className = "bookshelf-grid";
        sortedShelfItems.slice(index, index + 10).forEach((item) => row.appendChild(item));
        shelf.appendChild(row);
      }
      const hiddenShelfItems = shelfItems.filter((item) => !visibleSlugs.has(item.dataset.slug));
      if (hiddenShelfItems.length) {
        const holdingRow = document.createElement("div");
        holdingRow.hidden = true;
        hiddenShelfItems.forEach((item) => holdingRow.appendChild(item));
        shelf.appendChild(holdingRow);
      }
    }

    if (grid) {
      gridItems.forEach((item) => {
        item.hidden = !visibleSlugs.has(item.dataset.slug);
      });
      sortedGridItems.forEach((item) => grid.appendChild(item));
    }

    if (count) {
      count.textContent = `${sortedGridItems.length} title${sortedGridItems.length === 1 ? "" : "s"} currently shown`;
    }

    if (empty) {
      empty.hidden = sortedGridItems.length !== 0;
    }

    scheduleShelfEdgeRefresh();
  };

  browsers.forEach((root) => {
    root.querySelectorAll("[data-store-view-button]").forEach((button) => {
      button.addEventListener("click", () => {
        root.dataset.storeViewLocked = "true";
        setBrowserView(root, button.dataset.storeViewButton || "");
      });
    });

    root.addEventListener("input", () => applyBrowser(root));
    root.addEventListener("change", () => applyBrowser(root));
    setBrowserView(root, root.dataset.storeViewLocked === "true" ? (root.dataset.storeView || getDefaultView(root)) : getDefaultView(root));
    applyBrowser(root);
  });

  if (!browsers.length) {
    scheduleShelfEdgeRefresh();
  }

  window.addEventListener("resize", () => {
    syncResponsiveBrowserViews();
    scheduleShelfEdgeRefresh();
  });
})();
