(() => {
  const shelf = document.querySelector('[data-live-homepage-shelf="best-sellers"]');
  if (!shelf) return;

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

  function createSpine(product) {
    const link = document.createElement("a");
    link.className = "shop-wall-sale-spine";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.slug = product.slug;
    link.dataset.productId = product.slug;
    link.dataset.guestProductPreview = previewPayload(product);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = product.title;
    const label = document.createElement("span");
    label.setAttribute("aria-hidden", "true");
    label.textContent = product.title;
    link.append(label);
    return link;
  }

  function createHero(product) {
    const link = document.createElement("a");
    link.className = "shop-wall-hero-book";
    link.href = product.fullUrl;
    link.dataset.productCard = "true";
    link.dataset.slug = product.slug;
    link.dataset.productId = product.slug;
    link.dataset.guestProductPreview = previewPayload(product);
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.title = product.title;
    const image = document.createElement("img");
    image.src = product.cover || "/assets/tobacco-road-games-logo.png";
    image.alt = `${product.title} cover`;
    image.loading = "lazy";
    image.decoding = "async";
    link.append(image);
    return link;
  }

  function hydrateBestSellers(products) {
    const list = Array.isArray(products) ? products.slice(0, 43) : [];
    if (!list.length) return;

    const heroBay = shelf.querySelector(".shop-wall-hero-bay");
    const leftRun = shelf.querySelector('[data-spine-run="left"]');
    const rightRun = shelf.querySelector('[data-spine-run="right"]');
    if (!heroBay || !leftRun || !rightRun) return;

    const heroTarget = heroBay.firstElementChild;
    if (heroTarget) heroTarget.replaceWith(createHero(list[0]));

    const spineProducts = list.slice(1);
    const leftProducts = spineProducts.slice(0, 21);
    const rightProducts = spineProducts.slice(21, 42);

    leftProducts.forEach((product, index) => {
      const target = leftRun.children[index];
      if (target) target.replaceWith(createSpine(product));
    });
    rightProducts.forEach((product, index) => {
      const target = rightRun.children[index];
      if (target) target.replaceWith(createSpine(product));
    });

    document.dispatchEvent(new CustomEvent("trg:homepage-shelves-updated", {
      detail: { shelf: "best-sellers", count: list.length }
    }));
  }

  window.TRGHomepageShelves = Object.freeze({ hydrateBestSellers });

  fetch("/api/homepage-shelves", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : { bestSellers: [] })
    .then((payload) => hydrateBestSellers(payload.bestSellers))
    .catch(() => {});
})();
