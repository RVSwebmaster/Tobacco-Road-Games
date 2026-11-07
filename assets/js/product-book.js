"use strict";

(function () {
  const REVOLUTION_MS = 30000;
  // Pixel depth at a 340px book height: 100 pages = 24px.
  function depthForPages(rawPageCount) {
    const pages = Number(rawPageCount);
    if (!Number.isInteger(pages) || pages < 1) return 24;
    return Math.min(60, Math.max(16, Math.round(24 + (pages - 100) * 0.1)));
  }

  if (typeof module === "object" && module.exports) module.exports = { depthForPages, REVOLUTION_MS };
  if (typeof document === "undefined") return;

  function face(className, child) {
    const element = document.createElement("div");
    element.className = `product-book__face ${className}`;
    if (child) element.append(child);
    return element;
  }

  function fallback(message) {
    const element = document.createElement("span");
    element.className = "product-book__fallback";
    element.textContent = message;
    return element;
  }

  function artwork(src, fallbackElement) {
    if (!src) return fallbackElement;
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.addEventListener("error", () => image.replaceWith(fallbackElement), { once: true });
    return image;
  }

  function generatedSpine(title, credit) {
    const panel = document.createElement("div");
    panel.className = "product-book__spine-art";
    const titleLine = document.createElement("strong");
    titleLine.className = "product-book__spine-title";
    titleLine.textContent = title;
    titleLine.title = title;
    panel.append(titleLine);
    if (credit) {
      const creditLine = document.createElement("span");
      creditLine.className = "product-book__spine-credit";
      creditLine.textContent = credit;
      creditLine.title = credit;
      panel.append(creditLine);
    }
    return panel;
  }

  function viewLabel(degrees) {
    if (degrees < 45 || degrees >= 315) return "Front cover";
    if (degrees < 135) return "Spine";
    if (degrees < 225) return "Back cover";
    return "Page edges";
  }

  function mount(media, index) {
    const cover = media.querySelector(".product-cover");
    if (!cover) return;

    const title = media.closest(".product-hero")?.querySelector("h1")?.textContent?.trim() || "product";
    const stage = document.createElement("div");
    stage.className = "product-book__stage";
    const book = document.createElement("div");
    book.className = "product-book";
    book.setAttribute("aria-hidden", "true");
    const front = face("product-book__front", cover);
    const back = face("product-book__back", artwork(media.dataset.backCover, fallback("Back cover artwork not available")));
    const spine = face("product-book__spine", artwork(media.dataset.spineArt, generatedSpine(title, media.dataset.spineCredit || "")));
    const pages = face("product-book__pages");
    book.append(front, back, spine, pages);
    stage.append(book);

    const control = document.createElement("div");
    control.className = "product-book__control";
    const line = document.createElement("div");
    line.className = "product-book__control-line";
    const label = document.createElement("label");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `product-book-rotation-${index}`;
    slider.min = "0";
    slider.max = "360";
    slider.step = "1";
    slider.value = "0";
    label.htmlFor = slider.id;
    label.textContent = "Rotate book";
    slider.setAttribute("aria-label", `Rotate ${title} book`);
    const output = document.createElement("output");
    output.htmlFor = slider.id;
    line.append(label, output);
    control.append(line, slider);

    let angle = 0;
    let automatic = false;
    let frame = 0;
    let lastFrame = null;
    const eligible = media.dataset.autoRotate === "true";
    const reducedMotion = eligible && window.matchMedia("(prefers-reduced-motion: reduce)");
    const toggle = eligible ? document.createElement("button") : null;
    if (toggle) {
      toggle.type = "button";
      toggle.className = "button button--secondary product-book__auto-toggle";
      control.append(toggle);
    }

    function rotate() {
      const degrees = ((angle % 360) + 360) % 360;
      book.style.setProperty("--book-angle", `${degrees}deg`);
      if (automatic) slider.value = String(Math.round(degrees) % 360);
      const displayed = !automatic && angle === 360 ? 360 : Math.round(degrees) % 360;
      output.value = `${viewLabel(degrees)} · ${displayed}°`;
    }
    function updateToggle() {
      if (!toggle) return;
      toggle.textContent = automatic ? "Pause rotation" : "Resume rotation";
      toggle.setAttribute("aria-label", `${automatic ? "Pause" : "Resume"} automatic rotation of ${title}`);
      book.classList.toggle("is-auto-rotating", automatic);
    }
    function advance(now) {
      if (lastFrame !== null) angle = (angle + Math.min(100, Math.max(0, now - lastFrame)) * 360 / REVOLUTION_MS) % 360;
      lastFrame = now;
      rotate();
    }
    function tick(now) {
      if (!automatic) return;
      advance(now);
      frame = window.requestAnimationFrame(tick);
    }
    function pause() {
      if (!automatic) return;
      advance(window.performance.now());
      automatic = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = null;
      updateToggle();
    }
    function resume() {
      if (!eligible || automatic || document.hidden) return;
      automatic = true;
      lastFrame = null;
      updateToggle();
      frame = window.requestAnimationFrame(tick);
    }
    slider.addEventListener("pointerdown", pause);
    slider.addEventListener("keydown", pause);
    slider.addEventListener("input", () => {
      pause();
      angle = Number(slider.value);
      rotate();
    });
    if (toggle) {
      toggle.addEventListener("click", () => automatic ? pause() : resume());
      reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) pause(); });
      document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
    }
    rotate();
    updateToggle();

    function size() {
      const ratio = cover.naturalWidth && cover.naturalHeight ? cover.naturalWidth / cover.naturalHeight : 0.75;
      const style = getComputedStyle(stage);
      const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
      const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const target = window.innerWidth <= 620 ? Math.min(310, window.innerWidth * 0.74) : 340;
      const bookHeight = Math.max(1, Math.min(target, height, width / ratio));
      book.style.setProperty("--book-height", `${bookHeight}px`);
      book.style.setProperty("--book-width", `${bookHeight * ratio}px`);
      book.style.setProperty("--book-depth", `${Math.max(12, Math.round(depthForPages(media.dataset.pageCount) * bookHeight / 340))}px`);
    }

    media.classList.add("is-book-display");
    media.replaceChildren(stage, control);
    cover.addEventListener("load", size);
    size();
    if (typeof ResizeObserver === "function") new ResizeObserver(size).observe(stage);
    else window.addEventListener("resize", size);
    if (eligible && !reducedMotion.matches && !document.hidden) resume();
  }

  function init() {
    document.querySelectorAll("[data-product-book]").forEach(mount);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
