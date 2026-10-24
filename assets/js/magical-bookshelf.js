(function (globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  globalScope.TRGMagicalBookshelf = api;

  if (globalScope.document) {
    globalScope.document.documentElement.classList.add("trg-magical-shelves");
    const initialize = () => api.initializeMagicalBookshelves(globalScope.document);
    if (globalScope.document.readyState === "loading") {
      globalScope.document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
      initialize();
    }
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_PAIR_SIZE = 2;
  const DEFAULT_INTERVAL_MS = 500;
  const FLASH_COLORS = ["#e8bd55", "#5ca9ff", "#a979ff", "#64c982", "#f18ab9", "#f1a447", "#ffffff"];

  function createFlashDescriptors(random = Math.random) {
    const flashCount = 1 + Math.floor(random() * 3);
    return Array.from({ length: flashCount }, () => ({
      color: FLASH_COLORS[Math.floor(random() * FLASH_COLORS.length)],
      durationMs: 420 + Math.floor(random() * 181),
      offsetX: -22 + Math.floor(random() * 45),
      offsetY: -14 + Math.floor(random() * 29),
      sizePx: 18 + Math.floor(random() * 17),
    }));
  }

  function buildRevealPlan(shelves, pairSize = DEFAULT_PAIR_SIZE) {
    const normalizedPairSize = Number.isInteger(pairSize) && pairSize > 0 ? pairSize : DEFAULT_PAIR_SIZE;
    const plan = [];
    shelves.forEach((books, shelfIndex) => {
      const count = Array.isArray(books) ? books.length : Number(books) || 0;
      for (let start = 0; start < count; start += normalizedPairSize) {
        plan.push({
          bookIndexes: Array.from({ length: Math.min(normalizedPairSize, count - start) }, (_, offset) => start + offset),
          shelfIndex,
        });
      }
    });
    return plan;
  }

  function orderBooksByDirection(books, direction, positionOf = (book) => book.getBoundingClientRect().left) {
    const ordered = Array.from(books || []).sort((left, right) => positionOf(left) - positionOf(right));
    if (direction === "right-to-left") return ordered.reverse();
    if (direction !== "outer-inward") return ordered;

    const outsideIn = [];
    let left = 0;
    let right = ordered.length - 1;
    while (left <= right) {
      outsideIn.push(ordered[left]);
      left += 1;
      if (left <= right) {
        outsideIn.push(ordered[right]);
        right -= 1;
      }
    }
    return outsideIn;
  }

  function buildEffectAnchors(bookRects, hostRect) {
    if (!hostRect?.width || !hostRect?.height) return [];
    return Array.from(bookRects || []).map((rect) => {
      const effectY = rect.top + Math.min(rect.height * .25, 36);
      return {
        bottomPercent: (hostRect.bottom - effectY) / hostRect.height * 100,
        leftPercent: ((rect.left + rect.right) / 2 - hostRect.left) / hostRect.width * 100,
      };
    });
  }

  function createSequenceRunner({
    steps = [],
    intervalMs = DEFAULT_INTERVAL_MS,
    revealStep = () => {},
    revealAll = () => {},
    clearEffects = () => {},
    onComplete = () => {},
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
  } = {}) {
    let index = 0;
    let running = false;
    let timer = null;

    const cancelTimer = () => {
      if (timer !== null) cancel(timer);
      timer = null;
    };

    const tick = () => {
      if (!running) return;
      const step = steps[index];
      if (!step) {
        running = false;
        timer = null;
        onComplete();
        return;
      }
      revealStep(step);
      index += 1;
      if (index >= steps.length) {
        running = false;
        timer = null;
        onComplete();
        return;
      }
      timer = schedule(tick, intervalMs);
    };

    return {
      finish() {
        if (!running && index >= steps.length) return;
        cancelTimer();
        revealAll();
        clearEffects();
        index = steps.length;
        running = false;
        onComplete();
      },
      isRunning() {
        return running;
      },
      start() {
        cancelTimer();
        index = 0;
        running = steps.length > 0;
        if (!running) {
          revealAll();
          onComplete();
          return;
        }
        tick();
      },
    };
  }

  function isTextEntryTarget(target) {
    if (!target || typeof target.matches !== "function") return false;
    return target.matches("input, textarea, select, button, [contenteditable]:not([contenteditable='false'])");
  }

  function isStagingPreviewHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "localhost"
      || host === "127.0.0.1"
      || host === "tobacco-road-games-staging.pages.dev"
      || host.endsWith(".tobacco-road-games-staging.pages.dev");
  }

  function initializeMagicalBookshelves(documentRef) {
    const root = documentRef.querySelector("[data-magical-bookshelf-demo]");
    if (!root) return null;

    const windowRef = documentRef.defaultView || globalThis;
    const desktopQuery = windowRef.matchMedia("(min-width: 1024px)");
    const reducedMotionQuery = windowRef.matchMedia("(prefers-reduced-motion: reduce)");
    const shelves = Array.from(root.querySelectorAll("[data-magical-bookshelf]"))
      .sort((left, right) => Number(left.dataset.magicalShelfOrder || 0) - Number(right.dataset.magicalShelfOrder || 0));
    const shelfBooks = shelves.map((shelf) => orderBooksByDirection(
      Array.from(shelf.querySelectorAll("[data-magical-book], .bookshelf-book, .shop-wall-stock-spine, .shop-wall-sale-spine, .shop-wall-hero-book")),
      shelf.dataset.magicalDirection
    ));
    const plan = buildRevealPlan(shelfBooks);
    const replay = root.querySelector("[data-magical-bookshelf-replay]");
    const effectTimers = new Set();

    const removeEffects = () => {
      effectTimers.forEach((timer) => windowRef.clearTimeout(timer));
      effectTimers.clear();
      root.querySelectorAll("[data-magical-effect]").forEach((effect) => effect.remove());
    };

    const setPending = () => {
      removeEffects();
      shelfBooks.flat().forEach((book) => {
        book.classList.add("is-magical-pending");
        book.classList.remove("is-magical-revealed");
      });
      root.dataset.magicalState = "pending";
    };

    const revealAll = () => {
      shelfBooks.flat().forEach((book) => {
        book.classList.remove("is-magical-pending");
        book.classList.add("is-magical-revealed");
      });
    };

    const addEffect = (shelf, books, sequenceIndex) => {
      if (!books.length || reducedMotionQuery.matches) return;
      const effectHost = shelf.closest(".shop-wall-shelf-level") || shelf;
      const hostRect = effectHost.getBoundingClientRect();
      const bookRects = books.map((book) => book.getBoundingClientRect());
      const anchors = buildEffectAnchors(bookRects, hostRect);
      if (!anchors.length) return;
      const effect = documentRef.createElement("span");
      effect.className = "guest-bookshelf-magic";
      effect.dataset.magicalEffect = "";
      effect.setAttribute("aria-hidden", "true");
      effect.style.setProperty("--magic-hue", String((sequenceIndex * 47 + 32) % 360));
      createFlashDescriptors().forEach((flash, flashIndex) => {
        const anchor = anchors[(sequenceIndex + flashIndex) % anchors.length];
        const light = documentRef.createElement("span");
        light.className = "guest-bookshelf-magic__flash";
        light.style.setProperty("--flash-color", flash.color);
        light.style.setProperty("--flash-duration", `${flash.durationMs}ms`);
        light.style.setProperty("--flash-left", `${anchor.leftPercent}%`);
        light.style.setProperty("--flash-bottom", `${anchor.bottomPercent}%`);
        light.style.setProperty("--flash-size", `${flash.sizePx}px`);
        light.style.setProperty("--flash-x", `${flash.offsetX}px`);
        light.style.setProperty("--flash-y", `${flash.offsetY}px`);
        effect.appendChild(light);
      });
      for (let spark = 0; spark < 8; spark += 1) {
        const anchor = anchors[spark % anchors.length];
        const particle = documentRef.createElement("i");
        particle.style.setProperty("--spark-angle", `${spark * 45}deg`);
        particle.style.setProperty("--spark-distance", `${14 + (spark % 3) * 6}px`);
        particle.style.setProperty("--spark-left", `${anchor.leftPercent}%`);
        particle.style.setProperty("--spark-bottom", `${anchor.bottomPercent}%`);
        effect.appendChild(particle);
      }
      effectHost.classList.add("has-magical-effect");
      effectHost.appendChild(effect);
      const timer = windowRef.setTimeout(() => {
        effect.remove();
        if (!effectHost.querySelector(".guest-bookshelf-magic")) effectHost.classList.remove("has-magical-effect");
        effectTimers.delete(timer);
      }, 760);
      effectTimers.add(timer);
    };

    let revealedStepCount = 0;
    const runner = createSequenceRunner({
      steps: plan,
      intervalMs: DEFAULT_INTERVAL_MS,
      revealStep(step) {
        const shelf = shelves[step.shelfIndex];
        const books = step.bookIndexes.map((bookIndex) => shelfBooks[step.shelfIndex][bookIndex]).filter(Boolean);
        books.forEach((book) => {
          book.classList.remove("is-magical-pending");
          book.classList.add("is-magical-revealed");
        });
        addEffect(shelf, books, revealedStepCount);
        revealedStepCount += 1;
      },
      revealAll,
      clearEffects: removeEffects,
      onComplete() {
        root.dataset.magicalState = "complete";
      },
      schedule: windowRef.setTimeout.bind(windowRef),
      cancel: windowRef.clearTimeout.bind(windowRef),
    });

    const play = () => {
      revealedStepCount = 0;
      setPending();
      if (!desktopQuery.matches || reducedMotionQuery.matches) {
        revealAll();
        root.dataset.magicalState = "complete";
        return;
      }
      root.dataset.magicalState = "running";
      runner.start();
    };

    if (replay && isStagingPreviewHost(windowRef.location.hostname)) {
      replay.hidden = false;
      replay.addEventListener("click", play);
    }

    documentRef.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || isTextEntryTarget(event.target) || !runner.isRunning()) return;
      event.preventDefault();
      runner.finish();
    });

    setPending();
    windowRef.requestAnimationFrame(play);
    return { play, runner, shelves };
  }

  return {
    buildEffectAnchors,
    buildRevealPlan,
    createFlashDescriptors,
    createSequenceRunner,
    initializeMagicalBookshelves,
    isStagingPreviewHost,
    isTextEntryTarget,
    orderBooksByDirection,
  };
});
