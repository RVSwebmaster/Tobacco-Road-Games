(() => {
  const cover = document.querySelector("[data-creator-profile-catalog-cover]");
  if (!cover || typeof window.fetch !== "function") return;

  const ROTATION_MS = 45_000;
  const origin = window.location.origin;
  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery?.matches === true;
  let products = [];
  let activeIndex = 0;
  let timer = null;

  function productCover(product) {
    if (!product || product.storefrontVisibility !== "listed") return "";
    try {
      const url = new URL(String(product.coverUrl || ""), origin);
      if (url.origin !== origin || !/^\/product-assets\/[a-z0-9-]+\/cover\.webp$/i.test(url.pathname)) return "";
      return url.pathname;
    } catch {
      return "";
    }
  }

  function paint(index) {
    const product = products[index];
    if (!product) return;
    const src = productCover(product);
    if (!src) return;
    cover.src = src;
    cover.dataset.activeProductId = String(product.id || "");
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    if (reducedMotion || document.hidden || products.length < 2) return;
    timer = window.setInterval(() => {
      activeIndex = (activeIndex + 1) % products.length;
      paint(activeIndex);
    }, ROTATION_MS);
  }

  async function load() {
    try {
      const optionsResponse = await window.fetch("/api/creator/identity-options", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!optionsResponse.ok) return;
      const options = await optionsResponse.json();
      if (!Array.isArray(options?.creators) || !options.creators.length) return;

      let stored = "";
      try { stored = window.localStorage.getItem("trg_current_creator_identity") || ""; } catch {}
      const requested = new URLSearchParams(window.location.search).get("creator") || "";
      const creator = options.creators.find(item => item.id === requested || item.slug === requested)
        || options.creators.find(item => item.id === stored || item.slug === stored)
        || options.creators[0];
      if (!creator?.id) return;

      const catalogUrl = new URL(String(cover.dataset.catalogApi || "/api/catalog"), origin);
      if (catalogUrl.origin !== origin || catalogUrl.pathname !== "/api/catalog") return;
      catalogUrl.searchParams.set("creatorId", creator.id);
      catalogUrl.searchParams.set("limit", "100");
      const catalogResponse = await window.fetch(catalogUrl.pathname + catalogUrl.search, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!catalogResponse.ok) return;
      const catalog = await catalogResponse.json();
      if (!Array.isArray(catalog?.products)) return;

      products = catalog.products.filter(product => product?.creatorId === creator.id && productCover(product));
      if (!products.length) return;
      paint(0);
      start();
    } catch {
      // The framed Familiar poster remains as the safe static fallback.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  motionQuery?.addEventListener?.("change", event => {
    reducedMotion = event.matches === true;
    if (reducedMotion) stop();
    else start();
  });
  load();
})();
