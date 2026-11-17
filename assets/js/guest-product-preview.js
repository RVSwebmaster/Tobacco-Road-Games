(() => {
  const page = document.querySelector("[data-guest-landing], [data-creator-identity-page]");
  if (!page) return;
  let books = [];
  let dialog;
  let activeBook;
  let restoreFocus;
  let activeOpenRulesExamination;
  const COVER_ONLY_CLASS = "guest-product-preview--cover-only";

  function restoreOpenRulesBook({ focus = true } = {}, state = activeOpenRulesExamination) {
    if (!state) return;
    state.product.style.setProperty("--book-angle", "90deg");
    state.product.style.setProperty("--book-width", state.originalFaceWidth);
    state.product.style.width = state.originalProductWidth;
    state.book.classList.remove("is-examining", "is-enlarging", "is-returning");
    ["position", "left", "top", "width", "height", "z-index", "--guest-examine-x", "--guest-examine-y", "--guest-examine-scale"].forEach((property) => state.book.style.removeProperty(property));
    state.closeButton?.removeEventListener("click", state.closeButtonHandler);
    state.closeButton?.remove();
    window.removeEventListener("resize", state.positionCloseButton);
    state.placeholder.replaceWith(state.book);
    state.book.setAttribute("aria-expanded", "false");
    state.book.setAttribute("aria-label", state.originalLabel);
    if (focus) state.book.focus({ preventScroll: true });
    if (activeOpenRulesExamination === state) activeOpenRulesExamination = null;
  }

  function closeOpenRulesBook(state = activeOpenRulesExamination) {
    if (!state || activeOpenRulesExamination !== state || state.phase === "returning") return;
    state.phase = "returning";
    state.closeButton.hidden = true;
    state.book.classList.remove("is-enlarging");
    state.book.classList.add("is-returning");
    void state.book.offsetWidth;

    let bookReturned = false;
    let rotationReturned = false;
    const finishReturn = (event) => {
      if (event?.target === state.book && event.propertyName === "transform") bookReturned = true;
      else if (event?.target === state.product && event.propertyName === "transform") rotationReturned = true;
      else if (event) return;
      if (!event || (bookReturned && rotationReturned)) {
        state.book.removeEventListener("transitionend", finishReturn);
        state.product.removeEventListener("transitionend", finishReturn);
        restoreOpenRulesBook({}, state);
      }
    };
    state.book.addEventListener("transitionend", finishReturn);
    state.product.addEventListener("transitionend", finishReturn);
    (window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0)))(() => {
      if (activeOpenRulesExamination !== state) return;
      state.product.style.setProperty("--book-angle", "90deg");
      state.book.style.setProperty("--guest-examine-x", "0px");
      state.book.style.setProperty("--guest-examine-y", "0px");
      state.book.style.setProperty("--guest-examine-scale", "1");
    });
    window.setTimeout(() => finishReturn(), 1700);
  }

  function positionExaminationCloseButton(state) {
    if (!state || state.closeButton.hidden || activeOpenRulesExamination !== state) return;
    const cover = state.product.querySelector(".product-book__front img");
    if (!cover) return;
    const rect = cover.getBoundingClientRect();
    const size = state.closeButton.getBoundingClientRect().width || 42;
    state.closeButton.style.left = `${Math.max(8, Math.min(window.innerWidth - size - 8, rect.right - size - 6))}px`;
    state.closeButton.style.top = `${Math.max(8, Math.min(window.innerHeight - size - 8, rect.top + 6))}px`;
  }

  function examineOpenRulesBook(book) {
    if (activeOpenRulesExamination?.book === book) return;
    if (activeOpenRulesExamination) restoreOpenRulesBook();

    const rect = book.getBoundingClientRect();
    const product = book.querySelector(".homepage-open-rules-book__product");
    const placeholder = document.createElement("span");
    placeholder.className = "guest-open-rules-examination-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    book.before(placeholder);

    const faceHeight = rect.height;
    const cover = product.querySelector(".product-book__front img");
    const coverRatio = cover?.naturalWidth > 0 && cover?.naturalHeight > 0 ? cover.naturalWidth / cover.naturalHeight : 0;
    const faceWidth = coverRatio > 0 ? faceHeight * coverRatio : Number.parseFloat(product.style.getPropertyValue("--book-width")) || 96;
    const originalFaceWidth = product.style.getPropertyValue("--book-width");
    const availableWidth = Math.max(1, window.innerWidth - 32);
    const availableHeight = Math.max(1, window.innerHeight - 96);
    const scale = Math.min(2.5, availableWidth / faceWidth, availableHeight / faceHeight);
    const originalLabel = book.getAttribute("aria-label") || book.title;
    const originalProductWidth = product.style.width;
    const title = book.title.split(" — ")[0];
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "guest-open-rules-examination-close";
    closeButton.setAttribute("aria-label", `Close ${title} examination and return it to the shelf`);
    closeButton.setAttribute("aria-keyshortcuts", "Escape");
    closeButton.title = "Return book to shelf";
    closeButton.textContent = "×";
    closeButton.hidden = true;
    const state = { book, product, placeholder, originalLabel, originalFaceWidth, originalProductWidth, closeButton, phase: "traveling" };
    state.closeButtonHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeOpenRulesBook(state);
    };
    state.positionCloseButton = () => positionExaminationCloseButton(state);
    closeButton.addEventListener("click", state.closeButtonHandler);
    activeOpenRulesExamination = state;

    book.style.setProperty("position", "fixed");
    book.style.setProperty("left", `${rect.left + (rect.width - faceWidth) / 2}px`);
    book.style.setProperty("top", `${rect.top}px`);
    book.style.setProperty("width", `${faceWidth}px`);
    book.style.setProperty("height", `${faceHeight}px`);
    book.style.setProperty("z-index", "10000");
    book.style.setProperty("--guest-examine-x", "0px");
    book.style.setProperty("--guest-examine-y", "0px");
    book.style.setProperty("--guest-examine-scale", "1");
    product.style.setProperty("--book-width", `${faceWidth}px`);
    product.style.width = `${faceWidth}px`;
    book.classList.add("is-examining");
    book.setAttribute("aria-expanded", "true");
    book.setAttribute("aria-label", book.hasAttribute("data-creator-preview-only")
      ? `Examining ${title} owner-only mock preview. No product page is attached.`
      : `Examining ${title}. Activate again to open its product page.`);
    document.body.append(book);
    document.body.append(closeButton);
    window.addEventListener("resize", state.positionCloseButton);
    book.focus({ preventScroll: true });
    void book.offsetWidth;

    const moveToViewer = () => {
      if (activeOpenRulesExamination !== state) return;
      book.style.setProperty("--guest-examine-x", `${window.innerWidth / 2 - (rect.left + rect.width / 2)}px`);
      book.style.setProperty("--guest-examine-y", `${window.innerHeight / 2 - (rect.top + rect.height / 2)}px`);
      product.style.setProperty("--book-angle", "0deg");
    };
    (window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0)))(moveToViewer);

    let bookStopped = false;
    let rotationStopped = false;
    let enlargementStarted = false;
    const finishEnlargement = (event) => {
      if (event && (event.target !== book || event.propertyName !== "transform")) return;
      if (activeOpenRulesExamination !== state || state.phase !== "enlarging") return;
      book.removeEventListener("transitionend", finishEnlargement);
      state.phase = "ready";
      book.setAttribute("aria-label", book.hasAttribute("data-creator-preview-only")
        ? `${title} owner-only mock preview. No product page is attached.`
        : `Open ${title} product page.`);
      closeButton.hidden = false;
      positionExaminationCloseButton(state);
    };
    const beginEnlargement = () => {
      if (enlargementStarted || !bookStopped || !rotationStopped || activeOpenRulesExamination !== state) return;
      enlargementStarted = true;
      state.phase = "enlarging";
      book.classList.add("is-enlarging");
      void book.offsetWidth;
      (window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0)))(() => {
        if (activeOpenRulesExamination === state) book.style.setProperty("--guest-examine-scale", String(scale));
      });
      book.addEventListener("transitionend", finishEnlargement);
      window.setTimeout(() => finishEnlargement(), 900);
    };
    const movementStopped = (event) => {
      if (event.target !== book || event.propertyName !== "transform" || activeOpenRulesExamination !== state || state.phase !== "traveling") return;
      book.removeEventListener("transitionend", movementStopped);
      bookStopped = true;
      beginEnlargement();
    };
    const rotationStoppedHandler = (event) => {
      if (event.target !== product || event.propertyName !== "transform" || activeOpenRulesExamination !== state || state.phase !== "traveling") return;
      product.removeEventListener("transitionend", rotationStoppedHandler);
      rotationStopped = true;
      beginEnlargement();
    };
    book.addEventListener("transitionend", movementStopped);
    product.addEventListener("transitionend", rotationStoppedHandler);
    window.setTimeout(() => {
      if (activeOpenRulesExamination === state && state.phase === "traveling") {
        bookStopped = true;
        rotationStopped = true;
        beginEnlargement();
      }
    }, 1700);
  }

  function bindOpenRulesExamination(book) {
    book.removeAttribute("aria-haspopup");
    book.setAttribute("aria-expanded", "false");
    book.addEventListener("click", (event) => {
      const state = activeOpenRulesExamination;
      if (state?.book === book && state.phase === "ready") {
        if (book.hasAttribute("data-creator-preview-only")) event.preventDefault();
        return;
      }
      event.preventDefault();
      examineOpenRulesBook(book);
    });
    book.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const state = activeOpenRulesExamination;
      if (state?.book === book && state.phase === "ready") {
        if (book.hasAttribute("data-creator-preview-only")) event.preventDefault();
        else window.location.assign(book.href);
      } else {
        examineOpenRulesBook(book);
      }
    });
  }

  function revealDetails() {
    if (!dialog?.classList.contains(COVER_ONLY_CLASS)) return;
    const summary = dialog.querySelector("[data-guest-preview-summary]");
    dialog.classList.remove(COVER_ONLY_CLASS);
    summary.setAttribute("aria-expanded", "true");
    summary.setAttribute("aria-label", `Open ${dialog.querySelector("[data-guest-preview-title]").textContent} full product profile`);
  }

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "guest-product-preview";
    dialog.setAttribute("aria-labelledby", "guest-product-preview-title");
    dialog.setAttribute("aria-describedby", "guest-product-preview-description");
    dialog.innerHTML = `<div class="guest-product-preview__panel"><button class="guest-product-preview__close" type="button" data-guest-preview-close aria-label="Close product preview">×</button><a class="guest-product-preview__summary" data-guest-preview-summary><img class="guest-product-preview__cover" data-guest-preview-cover alt=""><div class="guest-product-preview__copy"><p class="guest-product-preview__kicker">Product preview</p><h2 id="guest-product-preview-title" data-guest-preview-title></h2><p class="guest-product-preview__creator" data-guest-preview-creator></p><p class="guest-product-preview__price" data-guest-preview-price></p><p id="guest-product-preview-description" data-guest-preview-description></p><span class="button button--primary">Open full product profile</span></div></a></div>`;
    document.body.append(dialog);
    dialog.querySelector("[data-guest-preview-close]").addEventListener("click", close);
    const summary = dialog.querySelector("[data-guest-preview-summary]");
    summary.addEventListener("click", (event) => {
      if (!dialog.classList.contains(COVER_ONLY_CLASS)) return;
      event.preventDefault();
      revealDetails();
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== " " || !dialog.classList.contains(COVER_ONLY_CLASS)) return;
      event.preventDefault();
      revealDetails();
    });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog?.open) close();
    }, true);
  }

  function open(book) {
    const product = JSON.parse(book.dataset.guestProductPreview || "null");
    if (!product) return;
    if (!dialog) createDialog();
    activeBook = book;
    restoreFocus = document.activeElement;
    dialog.querySelector("[data-guest-preview-cover]").src = product.cover;
    dialog.querySelector("[data-guest-preview-cover]").alt = `${product.title} cover`;
    dialog.querySelector("[data-guest-preview-title]").textContent = product.title;
    dialog.querySelector("[data-guest-preview-creator]").textContent = `By ${product.creator}`;
    dialog.querySelector("[data-guest-preview-price]").textContent = product.priceLabel;
    dialog.querySelector("[data-guest-preview-description]").textContent = product.description;
    const summary = dialog.querySelector("[data-guest-preview-summary]");
    summary.href = product.fullUrl;
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-label", `Show information for ${product.title}`);
    dialog.classList.add(COVER_ONLY_CLASS);
    dialog.showModal();
    summary.focus();
  }

  function close() {
    if (!dialog?.open) return;
    dialog.close();
    (restoreFocus || activeBook)?.focus?.();
    restoreFocus = null;
    activeBook = null;
  }

  function bindBooks() {
    books = Array.from(page.querySelectorAll("[data-guest-product-preview]"));
    books.forEach((book) => {
      if (book.dataset.guestPreviewBound === "true") return;
      book.dataset.guestPreviewBound = "true";
      if (book.classList.contains("guest-open-rules-real-book") && ["/", "/guest/", "/customer", "/customer/", "/creator", "/creator/"].includes(window.location.pathname)) {
        bindOpenRulesExamination(book);
        return;
      }
      book.setAttribute("aria-haspopup", "dialog");
      book.addEventListener("click", (event) => { event.preventDefault(); open(book); });
      book.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(book);
      });
    });
  }

  document.addEventListener("trg:homepage-shelves-updated", bindBooks);
  document.addEventListener("trg:creator-library-updated", bindBooks);
  bindBooks();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeOpenRulesExamination) {
      event.preventDefault();
      closeOpenRulesBook();
    }
  });
  window.addEventListener("pagehide", () => {
    if (activeOpenRulesExamination) restoreOpenRulesBook({ focus: false });
  });

  if (!page.matches("[data-creator-identity-page]")) fetch("/data/guest-preview-products.json?v=20261112-cover-first-preview1", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : [])
    .then((products) => {
      const shelfByCollection = {
        "open-rules-upper": page.querySelectorAll(".guest-open-rules-books")[0],
        "open-rules-lower": page.querySelectorAll(".guest-open-rules-books")[1],
        "featured-creator": page.querySelector('[aria-label="FEATURED CREATOR shelf"] [data-magical-bookshelf]'),
        "new-this-week": page.querySelector('[aria-label="NEW THIS WEEK shelf"] [data-magical-bookshelf]'),
        "best-sellers": page.querySelector('[aria-label="BEST SELLERS shelf"] [data-magical-bookshelf]')
      };
      const explicitProducts = new Map(products.map((product) => [`${product.collection}:${product.position}`, product]));
      const stagingProductFor = (collection, position) => explicitProducts.get(`${collection}:${position}`) || {
        slug: `staging-${collection}-${position}`,
        title: `${collection.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} Book ${position}`,
        creator: "Tobacco Road Games",
        priceLabel: "Staging Preview",
        description: "A staging-only product preview assigned to this visible shelf position.",
        cover: "/assets/tobacco-road-games-logo.png",
        fullUrl: "/guest/preview-products/lantern-keep-encounters/",
        collection,
        position
      };
      Object.entries(shelfByCollection).forEach(([collection, shelf]) => {
        if (!shelf || collection.startsWith("open-rules-")) return;
        const shelfBooks = Array.from(shelf.querySelectorAll("[data-magical-book], .shop-wall-stock-spine, .shop-wall-hero-book"));
        shelfBooks.forEach((book, index) => {
          const realProductLink = book.matches?.('a[href*="/store/products/"]')
            ? book
            : book.querySelector?.('a[href*="/store/products/"]');
          if (realProductLink) return;
          const product = stagingProductFor(collection, index + 1);
          const link = document.createElement("a");
          link.className = "guest-product-preview-link";
          link.href = product.fullUrl;
          link.dataset.guestProductPreview = JSON.stringify(product);
          book.removeAttribute("aria-hidden");
          link.setAttribute("aria-haspopup", "dialog");
          link.setAttribute("aria-label", `Preview ${product.title}`);
          book.append(link);
        });
      });
      bindBooks();
    })
    .catch(() => {});
})();
