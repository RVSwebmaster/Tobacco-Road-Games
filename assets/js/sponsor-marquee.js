(() => {
  const root = document.querySelector("[data-sponsor-marquee]");
  if (!root) return;
  const track = root.querySelector("[data-sponsor-track]");
  let paused = false;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.addEventListener("mouseenter", () => { paused = true; });
  root.addEventListener("mouseleave", () => { paused = false; });
  root.addEventListener("focusin", () => { paused = true; });
  root.addEventListener("focusout", () => { paused = false; });
  async function log(item, eventType) {
    try { await fetch("/api/ad-rotation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adKey: item.adKey, adKind: item.adKind, eventType }), keepalive: true }); } catch {}
  }
  fetch("/api/ad-rotation?pool=sponsor-marquee", { credentials: "same-origin" }).then((response) => response.json()).then(({ items = [] }) => {
    if (!items.length) return;
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const link = document.createElement("a");
      link.className = "sponsor-marquee__item"; link.href = item.destinationUrl; link.target = "_blank"; link.rel = "noopener noreferrer sponsored";
      const image = document.createElement("img"); image.src = item.creativeUrl; image.alt = item.altText; image.loading = "lazy"; image.decoding = "async";
      const label = document.createElement("span"); label.textContent = item.label || "Sponsored";
      link.append(image, label); link.addEventListener("click", () => log(item, "click")); fragment.append(link); log(item, "impression");
    });
    track.append(fragment); root.hidden = false;
    if (!reducedMotion) {
      let offset = 0; let previous = performance.now();
      const move = (now) => { if (!paused) { offset = (offset + (now - previous) * 0.018) % Math.max(track.scrollWidth, 1); track.style.transform = `translateX(${-offset}px)`; } previous = now; requestAnimationFrame(move); };
      requestAnimationFrame(move);
    }
  }).catch(() => {});
})();
