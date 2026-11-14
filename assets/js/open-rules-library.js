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

  function createRotationSpine(product) {
    const panel = document.createElement("span");
    panel.className = "product-book__spine-art";
    const title = document.createElement("strong");
    title.className = "product-book__spine-title";
    title.textContent = product.title;
    title.title = product.title;
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

  function createOpenRulesSpine(product) {
    const link = document.createElement("a");
    const pageCount = Number(product.metadata?.pageCount);
    const shelfWidth = product.slug === "5e-monster-guide"
      ? 16
      : Math.max(12, Math.round(depthForPages(pageCount) * 220 / 340));
    link.className = "shop-wall-product-mock shop-wall-product-mock--spine homepage-library-book homepage-open-rules-book";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.productId = product.id || product.slug;
    link.dataset.slug = product.slug;
    link.dataset.pageCount = Number.isInteger(pageCount) && pageCount > 0 ? String(pageCount) : "";
    link.dataset.guestProductPreview = previewPayload(product);
    link.style.setProperty("--open-rules-spine-width", `${shelfWidth}px`);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = `${product.title} — ${product.creator}`;
    link.append(createRotationBook(product, shelfWidth));
    return link;
  }

  function createGuestOpenRulesBook(product, baseWidth) {
    const book = document.createElement("span");
    book.className = "guest-open-rules-real-book";
    book.dataset.magicalBook = "true";
    book.dataset.productId = product.id || product.slug;
    book.dataset.slug = product.slug;
    const pageCount = Number(product.metadata?.pageCount);
    const depth = depthForPages(pageCount);
    book.dataset.pageCount = Number.isInteger(pageCount) && pageCount > 0 ? String(pageCount) : "";
    book.style.setProperty("--open-rules-spine-ratio", String(depth / 24));

    const link = document.createElement("a");
    link.className = "guest-open-rules-real-book__link";
    link.href = product.fullUrl;
    link.dataset.guestProductPreview = previewPayload(product);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = `${product.title} — ${product.creator}`;
    link.append(createRotationBook(product, baseWidth * depth / 24));
    book.replaceChildren(link);
    return book;
  }

  window.TRGOpenRulesLibrary = Object.freeze({
    createGuestOpenRulesBook,
    createOpenRulesSpine,
    depthForPages
  });
})();
