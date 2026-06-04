(() => {
  const grid = document.getElementById("catalog-grid");
  const controls = document.getElementById("catalog-controls");

  if (!grid || !controls) {
    return;
  }

  const searchField = document.getElementById("catalog-search");
  const authorField = document.getElementById("catalog-author");
  const systemField = document.getElementById("catalog-system");
  const lineField = document.getElementById("catalog-line");
  const statusField = document.getElementById("catalog-status");
  const sortField = document.getElementById("catalog-sort");
  const countField = document.getElementById("catalog-count");
  const emptyState = document.getElementById("catalog-empty");
  const cards = Array.from(grid.querySelectorAll("[data-product-card]"));

  const applyFilters = () => {
    const query = (searchField?.value || "").trim().toLowerCase();
    const author = authorField?.value || "";
    const system = systemField?.value || "";
    const line = lineField?.value || "";
    const status = statusField?.value || "";
    const sortMode = sortField?.value || "title";

    const visibleCards = cards.filter((card) => {
      const matchesQuery = !query || card.dataset.search.includes(query);
      const matchesAuthor = !author || card.dataset.author.split("|").includes(author);
      const matchesSystem = !system || card.dataset.system === system;
      const matchesLine = !line || card.dataset.line === line;
      const matchesStatus = !status || card.dataset.status === status;
      return matchesQuery && matchesAuthor && matchesSystem && matchesLine && matchesStatus;
    });

    visibleCards.sort((left, right) => {
      if (sortMode === "newest") {
        return Number(right.dataset.release || 0) - Number(left.dataset.release || 0);
      }

      if (sortMode === "updated") {
        return Number(right.dataset.updated || 0) - Number(left.dataset.updated || 0);
      }

      return (left.dataset.title || "").localeCompare(right.dataset.title || "");
    });

    cards.forEach((card) => {
      card.hidden = !visibleCards.includes(card);
    });

    visibleCards.forEach((card) => grid.appendChild(card));

    if (countField) {
      countField.textContent = `${visibleCards.length} title${visibleCards.length === 1 ? "" : "s"} on the shelf`;
    }

    if (emptyState) {
      emptyState.hidden = visibleCards.length !== 0;
    }
  };

  controls.addEventListener("input", applyFilters);
  controls.addEventListener("change", applyFilters);
  applyFilters();
})();
