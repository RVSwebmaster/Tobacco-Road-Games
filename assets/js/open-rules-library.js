(() => {
  function depthForPages(rawPageCount) {
    const pages = Number(rawPageCount);
    if (!Number.isInteger(pages) || pages < 1) return 24;
    return Math.min(60, Math.max(16, Math.round(24 + (pages - 100) * 0.1)));
  }

  function previewPayload(product) {
    return JSON.stringify({
      slug: product.slug,
      title: product.title,
      creator: product.creator,
      priceLabel: product.priceLabel,
      description: product.description,
      cover: product.cover,
      fullUrl: product.fullUrl
    });
  }

  function fitSpineTitle(title) {
    const schedule = window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 0);
    const fit = () => {
      if (!title.isConnected) return;
      const available = title.clientHeight;
      const content = title.scrollHeight;
      const scale = available > 0 && content > available
        ? Math.max(0.1, (available - 1) / content)
        : 1;
      title.style.setProperty("--open-rules-title-scale", scale.toFixed(3));
    };

    schedule(() => {
      fit();
      if (!title.isConnected || !window.ResizeObserver) return;
      const observer = new window.ResizeObserver(fit);
      observer.observe(title.parentElement);
      title._openRulesTitleObserver = observer;
    });
  }

  function createRotationSpine(product) {
    const panel = document.createElement("span");
    panel.className = "product-book__spine-art";
    const title = document.createElement("strong");
    title.className = "product-book__spine-title";
    title.textContent = product.title;
    title.title = product.title;
    fitSpineTitle(title);
    const credit = document.createElement("span");
    credit.className = "product-book__spine-credit";
    credit.textContent = product.creator || "Tobacco Road Games";
    credit.title = credit.textContent;
    panel.append(title, credit);
    return panel;
  }

  // This is the single Open Rules book construction used by every shelf view.
  function createRotationBook(product, spineWidth) {
    const stage = document.createElement("span");
    stage.className = "homepage-open-rules-book__rotation";
    stage.setAttribute("aria-hidden", "true");

    const book = document.createElement("span");
    book.className = "product-book homepage-open-rules-book__product";
    // Keep the approved Monster Guide depth without collapsing the book body.
    book.style.setProperty("--book-angle", "90deg");
    const depth = Math.max(10, Number(spineWidth) || 12);
    book.style.setProperty("--book-depth", `${depth}px`);
    book.style.setProperty("--book-width", `${Math.max(80, depth * 8)}px`);
    // The cover planes sit just inside the spine's physical edges so their
    // artwork cannot protrude beside the spine at the shelf-facing angle.
    book.style.setProperty("--book-face-inset", "1px");

    const front = document.createElement("span");
    front.className = "product-book__face product-book__front";
    const cover = document.createElement("img");
    cover.className = "product-cover";
    cover.src = product.cover || "/assets/tobacco-road-games-logo.png";
    cover.alt = "";
    cover.loading = "lazy";
    cover.decoding = "async";
    front.append(cover);

    const back = document.createElement("span");
    back.className = "product-book__face product-book__back";
    const backCover = document.createElement("img");
    backCover.src = cover.src;
    backCover.alt = "";
    backCover.loading = "lazy";
    backCover.decoding = "async";
    back.append(backCover);

    const spine = document.createElement("span");
    spine.className = "product-book__face product-book__spine";
    spine.append(createRotationSpine(product));

    const pages = document.createElement("span");
    pages.className = "product-book__face product-book__pages";

    book.append(front, back, spine, pages);
    stage.append(book);
    return stage;
  }

  function createOpenRulesShelfBook(product, position = 0, baseWidth = 12) {
    const book = document.createElement("a");
    const pageCount = Number(product.metadata?.pageCount);
    const depth = depthForPages(pageCount);
    const spineWidth = Math.max(8, (Number(baseWidth) || 12) * depth / 24);
    const heights = [79, 86, 72];
    book.className = "guest-open-rules-mock-book guest-open-rules-real-book homepage-open-rules-book";
    book.href = product.fullUrl;
    book.dataset.productCard = "true";
    book.dataset.magicalBook = "true";
    book.dataset.productId = product.id || product.slug;
    book.dataset.slug = product.slug;
    book.dataset.pageCount = Number.isInteger(pageCount) && pageCount > 0 ? String(pageCount) : "";
    book.dataset.guestProductPreview = previewPayload(product);
    book.style.setProperty("--open-rules-spine-ratio", String(depth / 24));
    book.style.setProperty("--open-rules-spine-width", `${spineWidth}px`);
    book.style.setProperty("--mock-book-height", `${heights[Math.abs(Number(position) || 0) % heights.length]}%`);
    book.setAttribute("aria-label", `Open ${product.title} product page`);
    book.title = `${product.title} — ${product.creator}`;
    book.append(createRotationBook(product, spineWidth));
    return book;
  }

  window.TRGOpenRulesLibrary = Object.freeze({
    createOpenRulesShelfBook,
    depthForPages
  });
})();
