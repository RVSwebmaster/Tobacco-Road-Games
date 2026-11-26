(() => {
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

  if (typeof module === "object" && module.exports) {
    module.exports = { createCatalogSlots };
  } else {
    window.createCreatorProfileCatalogSlots = createCatalogSlots;
  }
})();
