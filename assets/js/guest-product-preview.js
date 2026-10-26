(() => {
  const page = document.querySelector("[data-guest-landing]");
  if (!page) return;
  let books = [];
  let dialog;
  let activeBook;
  let restoreFocus;

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "guest-product-preview";
    dialog.setAttribute("aria-labelledby", "guest-product-preview-title");
    dialog.setAttribute("aria-describedby", "guest-product-preview-description");
    dialog.innerHTML = `<div class="guest-product-preview__panel"><button class="guest-product-preview__close" type="button" data-guest-preview-close aria-label="Close product preview">×</button><a class="guest-product-preview__summary" data-guest-preview-summary><img class="guest-product-preview__cover" data-guest-preview-cover alt=""><div class="guest-product-preview__copy"><p class="guest-product-preview__kicker">Product preview</p><h2 id="guest-product-preview-title" data-guest-preview-title></h2><p class="guest-product-preview__creator" data-guest-preview-creator></p><p class="guest-product-preview__price" data-guest-preview-price></p><p id="guest-product-preview-description" data-guest-preview-description></p><span class="button button--primary">Open full product profile</span></div></a></div>`;
    document.body.append(dialog);
    dialog.querySelector("[data-guest-preview-close]").addEventListener("click", close);
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
    dialog.querySelector("[data-guest-preview-summary]").href = product.fullUrl;
    dialog.showModal();
    dialog.querySelector("[data-guest-preview-close]").focus();
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
    book.addEventListener("click", (event) => { event.preventDefault(); open(book); });
    book.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(book);
    });
    });
  }

  fetch("/data/guest-preview-products.json?v=20261025-preview3", { cache: "no-store" })
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
        if (!shelf) return;
        const shelfBooks = Array.from(shelf.querySelectorAll("[data-magical-book], .shop-wall-stock-spine, .shop-wall-hero-book"));
        shelfBooks.forEach((book, index) => {
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
