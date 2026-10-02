(() => {
  const browsers = Array.from(document.querySelectorAll("[data-store-browser]"));
  const shelves = Array.from(document.querySelectorAll(".bookshelf-grid"));
  const compactCatalogQuery = window.matchMedia("(max-width: 980px), (hover: none)");
  let shelfRefreshTimer = 0;

  document.querySelectorAll("body:has(.homepage-shop-wall) .site-nav").forEach((nav) => {
    const moveBrackets = (link) => {
      const navRect = nav.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();

      nav.style.setProperty("--nav-bracket-left", `${linkRect.left - navRect.left + nav.scrollLeft - 6}px`);
      nav.style.setProperty("--nav-bracket-top", `${linkRect.top - navRect.top}px`);
      nav.style.setProperty("--nav-bracket-width", `${linkRect.width + 12}px`);
      nav.style.setProperty("--nav-bracket-height", `${linkRect.height}px`);
      nav.classList.add("is-bracketing");
    };

    nav.addEventListener("pointerover", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || !nav.contains(link)) return;
      moveBrackets(link);
    });

    nav.addEventListener("pointerleave", () => {
      nav.classList.remove("is-bracketing");
    });
  });

  const fillMockBooks = (row, count) => {
    const reference = row.firstElementChild;
    if (!reference) return;
    if (!Number.isInteger(count) || count < 1) return;

    while (row.children.length < count) {
      const book = reference.cloneNode(true);
      book.setAttribute('aria-hidden', 'true');
      row.appendChild(book);
    }
    while (row.children.length > count) row.lastElementChild.remove();
  };

  document.querySelectorAll('.shop-wall-product-row[data-fill-spines]').forEach((row) => {
    fillMockBooks(row, Number(row.dataset.bookCount));
  });

  document.querySelectorAll('[data-fill-library]').forEach((books) => {
    const row = books.parentElement;
    const refresh = () => {
      const stopSide = row.classList.contains('shop-wall-product-row--right') ? '::before' : '::after';
      const spineWidth = Number.parseFloat(getComputedStyle(row, stopSide).width);
      if (!Number.isFinite(spineWidth) || spineWidth <= 0) return;
      // Keep the five reference-book widths and the stop clear on the wall side.
      const clearance = spineWidth * 6;
      row.style.setProperty('--library-bookstop-clearance', `${clearance}px`);
      const availableWidth = row.getBoundingClientRect().width - clearance;
      fillMockBooks(books, Math.max(1, Math.floor(availableWidth / spineWidth)));
    };
    refresh();
    new ResizeObserver(refresh).observe(row);
  });

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
      const usesCenteredExamination = Boolean(shelf.closest(".shelf-storefront"));
      const rows = getBooksByRow(shelf);

      shelf.querySelectorAll(".bookshelf-book").forEach((item) => {
        item.classList.remove("bookshelf-book--edge-right");
      });

      if (usesCenteredExamination) return;
      rows.forEach((rowItems) => {
        const autoEdgeCandidates = rowItems.filter((item) => item.dataset.bookshelfForceRight !== "true");

        if (!autoEdgeCandidates.length) {
          return;
        }

        const inwardOpeningItems = rowItems.length >= 11
          ? autoEdgeCandidates.slice(-2)
          : autoEdgeCandidates.slice(-1);

        inwardOpeningItems.forEach((item) => item.classList.add("bookshelf-book--edge-right"));
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
    const matchesHold = item.dataset.ownerReviewHold !== "true";
    const matchesDiscovery = !window.TRGMarketplaceDiscovery || window.TRGMarketplaceDiscovery.matchesMarketplaceProduct({
      genre: item.dataset.genre,
      playerCountMin: item.dataset.playerCountMin,
      playerCountMax: item.dataset.playerCountMax,
      gmMode: item.dataset.gmMode,
      prepBurden: item.dataset.prepBurden,
      playMode: item.dataset.playMode,
      rulesComplexity: item.dataset.rulesComplexity,
      mediaType: item.dataset.mediaType
    }, state);

    return matchesQuery
      && matchesAuthor
      && matchesSystem
      && matchesLine
      && matchesSeries
      && matchesStatus
      && matchesFormat
      && matchesPriceType
      && matchesSale
      && matchesHold
      && matchesDiscovery;
  };

  const syncReviewHolds = async () => {
    const targets = Array.from(document.querySelectorAll("[data-product-card][data-slug], .bookshelf-book[data-slug], [data-cart-add]"));
    const slugs = [...new Set(targets.map((item) => item.dataset.slug || item.dataset.cartAdd).filter(Boolean))];
    if (!slugs.length) return;
    try {
      const response = await fetch(`/api/listing-availability?slugs=${encodeURIComponent(slugs.join(","))}`, { credentials: "same-origin" });
      if (!response.ok) return;
      const unavailable = new Set((await response.json()).unavailable || []);
      targets.forEach((item) => {
        const held = unavailable.has(item.dataset.slug || item.dataset.cartAdd);
        if (item.matches("[data-product-card], .bookshelf-book")) { item.dataset.ownerReviewHold = held ? "true" : "false"; item.hidden = held; }
        if (item.matches("[data-cart-add]")) {
          item.disabled = held;
          item.title = held ? "This product is not currently available for sale." : "";
        }
      });
      browsers.forEach(applyBrowser);
    } catch {}
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
    saleOnly: Boolean(root.querySelector("[data-filter-sale]")?.checked),
    genre: root.querySelector("[data-filter-genre]")?.value || "",
    playerCount: root.querySelector("[data-filter-player-count]")?.value || "",
    gmMode: root.querySelector("[data-filter-gm-mode]")?.value || "",
    prepBurden: root.querySelector("[data-filter-prep-burden]")?.value || "",
    playMode: root.querySelector("[data-filter-play-mode]")?.value || "",
    rulesComplexity: root.querySelector("[data-filter-rules-complexity]")?.value || "",
    mediaType: root.querySelector("[data-filter-media-type]")?.value || ""
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
    const searchOnly = root.dataset.searchResults === "true";
    const shelf = root.querySelector("[data-store-shelf]");
    const grid = root.querySelector("[data-store-grid]");
    const count = root.querySelector("[data-store-count]");
    const empty = root.querySelector("[data-store-empty]");
    const shelfItems = shelf ? Array.from(shelf.querySelectorAll("[data-product-card]")) : [];
    const gridItems = grid ? Array.from(grid.querySelectorAll("[data-product-card]")) : [];
    const sortedGridItems = sortItems(gridItems.filter((item) => (!searchOnly || state.query) && matchesFilters(item, state)), state.sortMode);
    const visibleSlugs = new Set(sortedGridItems.map((item) => item.dataset.slug));

    if (shelf) {
      const sortedShelfItems = sortItems(shelfItems.filter((item) => visibleSlugs.has(item.dataset.slug)), state.sortMode);
      shelfItems.forEach((item) => {
        item.hidden = !visibleSlugs.has(item.dataset.slug);
      });
      const hiddenShelfItems = shelfItems.filter((item) => !visibleSlugs.has(item.dataset.slug));
      shelf.replaceChildren();
      for (let index = 0; index < sortedShelfItems.length; index += 12) {
        const shelfRow = document.createElement("div");
        const rowItems = sortedShelfItems.slice(index, index + 12);
        shelfRow.className = "bookshelf-grid";
        shelfRow.style.setProperty("--shelf-items", String(rowItems.length));
        rowItems.forEach((item, rowIndex) => {
          item.classList.toggle("bookshelf-book--edge-right", !root.closest(".shelf-storefront") && rowItems.length >= 11 && rowIndex >= rowItems.length - 2);
          shelfRow.appendChild(item);
        });
        shelf.appendChild(shelfRow);
      }
      if (hiddenShelfItems.length) {
        const holdingArea = document.createElement("div");
        holdingArea.hidden = true;
        hiddenShelfItems.forEach((item) => holdingArea.appendChild(item));
        shelf.appendChild(holdingArea);
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
      empty.hidden = searchOnly && !state.query ? true : sortedGridItems.length !== 0;
    }

    if (searchOnly) {
      const heading = document.querySelector("[data-search-results-heading]");
      const prompt = document.querySelector("[data-search-results-prompt]");
      if (heading) heading.textContent = state.query ? `Search Results — “${state.query}”` : "Search Results";
      if (prompt) prompt.textContent = state.query ? `${sortedGridItems.length} canonical catalog match${sortedGridItems.length === 1 ? "" : "es"}.` : "Search the catalog by title, Creator, system, series, or tag.";
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

  syncReviewHolds();

  const discoveryShelf = document.querySelector("[data-canonical-discovery-shelf]");
  if (discoveryShelf) {
    const label = discoveryShelf.dataset.canonicalDiscoveryShelf;
    const books = Array.from(discoveryShelf.querySelectorAll(".bookshelf-book[data-slug]"));
    Promise.all(books.map(async (book) => {
      try {
        const response = await fetch(`/api/discovery-labels?type=product&subject=${encodeURIComponent(book.dataset.slug)}`);
        const payload = response.ok ? await response.json() : { labels: [] };
        book.hidden = !(payload.labels || []).some((item) => item.id === label);
      } catch { book.hidden = true; }
    })).then(() => {
      discoveryShelf.querySelector("[data-discovery-empty]").hidden = books.some((book) => !book.hidden);
      scheduleShelfEdgeRefresh();
    });
  }

  const examinationBooks = Array.from(document.querySelectorAll(".shelf-storefront .bookshelf-book"));
  const touchLayoutQuery = matchMedia("(hover: none), (pointer: coarse)");
  const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let activeExamination = null;

  const presentationRect = (book) => {
    const parts = [book.querySelector(".bookshelf-book__cover-frame"), book.querySelector(".bookshelf-book__details")].filter(Boolean).map((part) => part.getBoundingClientRect());
    return parts.reduce((box, part) => ({ left: Math.min(box.left, part.left), top: Math.min(box.top, part.top), right: Math.max(box.right, part.right), bottom: Math.max(box.bottom, part.bottom) }), parts[0] || book.getBoundingClientRect());
  };
  const contains = (rect, x, y, padding = 0) => x >= rect.left - padding && x <= rect.right + padding && y >= rect.top - padding && y <= rect.bottom + padding;
  const inTransitZone = (origin, foreground, x, y) => {
    if (contains(origin, x, y, 20) || contains(foreground, x, y, 20)) return true;
    const start = { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 };
    const end = { x: (foreground.left + foreground.right) / 2, y: (foreground.top + foreground.bottom) / 2 };
    const delta = { x: end.x - start.x, y: end.y - start.y };
    const lengthSquared = delta.x * delta.x + delta.y * delta.y;
    const progress = lengthSquared ? Math.max(0, Math.min(1, ((x - start.x) * delta.x + (y - start.y) * delta.y) / lengthSquared)) : 0;
    const center = { x: start.x + delta.x * progress, y: start.y + delta.y * progress };
    const halfWidth = (origin.width / 2) * (1 - progress) + ((foreground.right - foreground.left) / 2) * progress + 28;
    const halfHeight = (origin.height / 2) * (1 - progress) + ((foreground.bottom - foreground.top) / 2) * progress + 28;
    return ((x - center.x) / halfWidth) ** 2 + ((y - center.y) / halfHeight) ** 2 <= 1;
  };
  const examinationCenter = (origin) => {
    const header = document.querySelector(".site-header")?.getBoundingClientRect();
    const marquee = document.querySelector("[data-sponsor-marquee]:not([hidden])")?.getBoundingClientRect();
    let usableTop = Math.max(0, header?.bottom || 0);
    if (marquee && marquee.top <= usableTop + 4) usableTop = Math.max(usableTop, marquee.bottom);
    const mobileBias = touchLayoutQuery.matches ? Math.min(90, window.innerHeight * 0.1) : 0;
    return { x: window.innerWidth / 2 - (origin.left + origin.width / 2), y: usableTop + (window.innerHeight - usableTop) / 2 - mobileBias - (origin.top + origin.height / 2) };
  };
  const finishExamination = (state = activeExamination) => {
    if (!state) return;
    state.book.classList.remove("is-examining", "is-returning");
    state.book.setAttribute("aria-expanded", "false");
    ["left", "top", "width", "height", "min-height", "--examination-x", "--examination-y", "--return-x", "--return-y"].forEach((property) => state.book.style.removeProperty(property));
    state.placeholder.remove();
    document.body.classList.remove("book-examination-active");
    if (activeExamination === state) activeExamination = null;
  };
  const closeExamination = ({ immediate = false } = {}) => {
    if (!activeExamination || activeExamination.returning) return;
    const state = activeExamination;
    const destination = state.placeholder.getBoundingClientRect();
    state.book.style.setProperty("--return-x", `${destination.left - state.origin.left}px`);
    state.book.style.setProperty("--return-y", `${destination.top - state.origin.top}px`);
    state.book.setAttribute("aria-expanded", "false");
    state.book.classList.add("is-returning");
    state.phase = "returning";
    state.returning = true;
    if (immediate || reducedMotionQuery.matches) finishExamination(state);
  };
  const openExamination = (book, mode) => {
    if (activeExamination?.book === book && !activeExamination.returning) return;
    if (activeExamination) finishExamination(activeExamination);
    const origin = book.getBoundingClientRect();
    const placeholder = document.createElement("span");
    placeholder.className = "bookshelf-book__placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.style.setProperty("--placeholder-width", `${origin.width}px`);
    placeholder.style.setProperty("--placeholder-height", `${origin.height}px`);
    book.before(placeholder);
    book.style.left = `${origin.left}px`;
    book.style.top = `${origin.top}px`;
    book.style.width = `${origin.width}px`;
    book.style.height = `${origin.height}px`;
    book.style.minHeight = `${origin.height}px`;
    const center = examinationCenter(origin);
    book.style.setProperty("--examination-x", `${center.x}px`);
    book.style.setProperty("--examination-y", `${center.y}px`);
    book.classList.add("is-examining"); book.setAttribute("aria-expanded", "true");
    document.body.classList.add("book-examination-active");
    activeExamination = { book, mode, origin, placeholder, returning: false, phase: reducedMotionQuery.matches ? "foreground-ready" : "traveling" };
  };

  examinationBooks.forEach((book) => {
    book.addEventListener("blur", () => { if (activeExamination?.mode === "keyboard") closeExamination(); });
    book.addEventListener("click", (event) => {
      if (!book.classList.contains("is-examining")) {
        event.preventDefault();
        openExamination(book, touchLayoutQuery.matches ? "touch" : "pointer");
      }
    });
    book.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (book.classList.contains("is-examining")) {
        if (event.key === " ") {
          event.preventDefault();
          book.click();
        }
      } else {
        event.preventDefault();
        openExamination(book, "keyboard");
      }
    });
    book.addEventListener("transitionend", (event) => {
      if (event.target !== book || event.propertyName !== "transform" || activeExamination?.book !== book) return;
      if (activeExamination.returning) finishExamination(activeExamination);
      else if (activeExamination.phase === "traveling") activeExamination.phase = "foreground-ready";
    });
  });
  document.addEventListener("pointermove", (event) => {
    if (!activeExamination || activeExamination.mode !== "pointer") return;
    const foreground = presentationRect(activeExamination.book);
    if (activeExamination.phase !== "traveling" && contains(foreground, event.clientX, event.clientY, 12)) { activeExamination.phase = "foreground"; return; }
    if (activeExamination.phase === "foreground") { closeExamination(); return; }
    if (!inTransitZone(activeExamination.origin, foreground, event.clientX, event.clientY)) closeExamination();
  });
  document.addEventListener("click", (event) => { if (activeExamination && !event.target.closest(".bookshelf-book.is-examining")) closeExamination(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeExamination(); event.preventDefault(); } });
  window.addEventListener("scroll", () => {
    if (activeExamination?.mode === "keyboard" && activeExamination.phase === "traveling") return;
    closeExamination();
  }, { passive: true });

  window.addEventListener("resize", () => {
    closeExamination({ immediate: true });
    syncResponsiveBrowserViews();
    scheduleShelfEdgeRefresh();
  });
})();
