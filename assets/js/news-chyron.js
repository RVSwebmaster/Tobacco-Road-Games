(() => {
  const pixelsPerSecond = 24;

  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const renderItems = (root, items) => {
    const sequence = root.querySelector('[data-news-sequence]');
    const duplicate = root.querySelector('[data-news-sequence-repeat]');
    if (!sequence || !duplicate) return;
    const markup = items.map((item) => `<li class="storefront-news-chiron__item"><a href="${escapeHtml(item.articleUrl)}" class="storefront-news-chiron__link" target="_blank" rel="noopener noreferrer"><span class="storefront-news-chiron__prefix">${escapeHtml(item.sourceName || "TTRPG NEWS")}</span><span class="storefront-news-chiron__headline">${escapeHtml(item.headline)}</span></a></li>`).join("");
    sequence.innerHTML = markup;
    duplicate.innerHTML = markup;
    duplicate.setAttribute("aria-hidden", "true");
  };

  document.querySelectorAll('[data-news-chyron]').forEach((root) => {
    const sequence = root.querySelector('[data-news-sequence]');
    if (!sequence) return;

    fetch(root.dataset.newsApi || "/api/news", { headers: { accept: "application/json" }, cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("news unavailable");
      return response.json();
    }).then((payload) => renderItems(root, Array.isArray(payload.items) ? payload.items : [])).catch(() => renderItems(root, []));

    const refresh = () => {
      const distance = sequence.getBoundingClientRect().width;
      if (!Number.isFinite(distance) || distance <= 0) return;
      root.style.setProperty('--news-duration', `${distance / pixelsPerSecond}s`);
      root.dataset.newsReady = 'true';
    };

    refresh();
    new ResizeObserver(refresh).observe(sequence);
    document.fonts?.ready.then(refresh);
  });
})();
