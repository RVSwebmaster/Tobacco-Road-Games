(() => {
  function sortAndFilterCatalog(products, sort = "title-asc", filter = "all") {
    const all = Array.isArray(products) ? products : [];
    const visible = all.filter(product => filter === "all" ||
      (filter === "shelved" ? product.shelved === true : filter === "unshelved" ? product.shelved !== true : true));
    const title = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    const series = product => String(product.metadata?.series || "").trim();
    const volume = product => Number(product.metadata?.volume);
    return [...visible].sort((a, b) => {
      const titleCompare = title(a, b);
      if (sort === "title-desc") return -titleCompare;
      if (sort === "newest" || sort === "oldest") {
        const dateCompare = String(a.publishedAt || a.updatedAt || "").localeCompare(String(b.publishedAt || b.updatedAt || ""));
        return (sort === "newest" ? -dateCompare : dateCompare) || titleCompare;
      }
      if (sort === "series") {
        const seriesCompare = series(a).localeCompare(series(b), undefined, { sensitivity: "base" });
        const volumeCompare = (Number.isFinite(volume(a)) ? volume(a) : Number.MAX_SAFE_INTEGER) -
          (Number.isFinite(volume(b)) ? volume(b) : Number.MAX_SAFE_INTEGER);
        return seriesCompare || volumeCompare || titleCompare;
      }
      return titleCompare;
    });
  }

  function createCatalogSlots(products, catalogLimit, slotCount = 30) {
    const items = Array.isArray(products) ? products : [];
    const count = Math.max(0, Math.floor(Number(slotCount) || 0));
    const allowance = catalogLimit === null
      ? count
      : Math.min(count, Math.max(0, Math.floor(Number(catalogLimit) || 0)));
    return Array.from({ length: count }, (_, index) => ({
      index,
      product: items[index] || null,
      hasShelfControl: index < allowance
    }));
  }

  function createMemberShelfBooks(products, creatorName = "") {
    return (Array.isArray(products) ? products : [])
      .filter(product => product?.shelved === true)
      .map(product => ({
        id: product.id,
        title: product.title,
        subtitle: product.subtitle,
        detailUrl: product.detailUrl,
        coverUrl: product.coverImage || "",
        creatorName
      }));
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { createCatalogSlots, sortAndFilterCatalog, createMemberShelfBooks };
  } else {
    window.createCreatorProfileCatalogSlots = createCatalogSlots;
    window.sortCreatorProfileCatalog = sortAndFilterCatalog;
    window.createCreatorProfileMemberShelfBooks = createMemberShelfBooks;
  }
})();
