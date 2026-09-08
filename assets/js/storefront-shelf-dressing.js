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

  const createIcon = (descriptor, role) => {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", `shelf-dressing__object shelf-dressing__object--${role} shelf-dressing__object--${descriptor.kind}`);
    icon.setAttribute("viewBox", "0 0 64 64");
    icon.setAttribute("focusable", "false");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", descriptor.sprite);
    icon.appendChild(use);
    return icon;
  };

  const createDecoration = (side, descriptor) => {
    const slot = document.createElement("span");
    slot.className = `shelf-dressing shelf-dressing--${side} shelf-dressing--${descriptor.secondary.kind}`;
    slot.dataset.shelfDressingSide = side;
    slot.dataset.shelfDressingPlant = descriptor.plant.asset;
    slot.dataset.shelfDressingSecondary = descriptor.secondary.asset;
    slot.setAttribute("aria-hidden", "true");
    slot.append(createIcon(descriptor.plant, "plant"), createIcon(descriptor.secondary, "secondary"));
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
