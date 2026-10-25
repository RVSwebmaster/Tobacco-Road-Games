(() => {
  const root = document.querySelector("[data-guest-preview-profile]");
  if (!root) return;
  const slug = root.dataset.productSlug;
  fetch("/data/guest-preview-products.json", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : [])
    .then((products) => {
      const product = products.find((entry) => entry.slug === slug);
      if (!product) return;
      root.querySelector("[data-preview-cover]").src = product.cover;
      root.querySelector("[data-preview-cover]").alt = `${product.title} cover`;
      root.querySelector("[data-preview-title]").textContent = product.title;
      root.querySelector("[data-preview-creator]").textContent = `By ${product.creator}`;
      root.querySelector("[data-preview-price]").textContent = product.priceLabel;
      root.querySelector("[data-preview-description]").textContent = product.description;
    }).catch(() => {});
})();
