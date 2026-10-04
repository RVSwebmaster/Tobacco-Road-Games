(() => {
  const themes = window.TRGStorefrontShelfThemes;
  const root = document.querySelector(".shelf-storefront");
  if (!themes || !root) return;

  let refreshFrame = 0;

  const shelfKey = (shelf) => {
    const labelledSection = shelf.closest("[aria-labelledby]");
    const headingId = labelledSection?.getAttribute("aria-labelledby") || "storefront-shelf";
    return headingId.replace(/-shelf-heading$|-heading$/, "");
  };

  const createArtwork = (descriptor, role) => {
    const artwork = document.createElement("img");
    const assetClass = descriptor.asset.replace(/[^a-z0-9-]/gi, "-");
    artwork.className = `shelf-dressing__object shelf-dressing__object--${role} shelf-dressing__object--${descriptor.kind} shelf-dressing__object--asset-${assetClass}`;
    artwork.src = descriptor.src;
    artwork.alt = "";
    artwork.width = 384;
    artwork.height = 384;
    artwork.loading = "lazy";
    artwork.decoding = "async";
    artwork.draggable = false;
    artwork.setAttribute("aria-hidden", "true");
    return artwork;
  };

  const createDecoration = (side, descriptor) => {
    const slot = document.createElement("span");
    slot.className = `shelf-dressing shelf-dressing--${side} shelf-dressing--${descriptor.secondary.kind}`;
    slot.dataset.shelfDressingSide = side;
    slot.dataset.shelfDressingPlant = descriptor.plant.asset;
    slot.dataset.shelfDressingSecondary = descriptor.secondary.asset;
    slot.setAttribute("aria-hidden", "true");
    slot.append(createArtwork(descriptor.plant, "plant"), createArtwork(descriptor.secondary, "secondary"));
    return slot;
  };

  const decorateShelves = () => {
    refreshFrame = 0;
    const activeTheme = themes.selectActiveTheme(new Date());
    const shelves = Array.from(root.querySelectorAll(".bookshelf-grid"));

    shelves.forEach((shelf, shelfIndex) => {
      const key = shelfKey(shelf);
      const dressing = themes.resolveShelfDressing({ shelfIndex, shelfKey: key, theme: activeTheme });
      const signature = `${dressing.themeId}:${shelfIndex}:${key}:${dressing.left.plant.asset}:${dressing.left.secondary.asset}:${dressing.right.plant.asset}:${dressing.right.secondary.asset}`;
      if (shelf.dataset.shelfDressingSignature === signature && shelf.querySelectorAll(":scope > .shelf-dressing").length === 2) return;

      shelf.querySelectorAll(":scope > .shelf-dressing").forEach((decoration) => decoration.remove());
      shelf.dataset.shelfDressingTheme = dressing.themeId;
      shelf.dataset.shelfDressingEventSide = dressing.eventSide || "none";
      shelf.dataset.shelfDressingSignature = signature;
      shelf.prepend(createDecoration("left", dressing.left));
      shelf.append(createDecoration("right", dressing.right));
    });
  };

  const scheduleRefresh = () => {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(decorateShelves);
  };

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(root, { childList: true, subtree: true });
  decorateShelves();
})();
