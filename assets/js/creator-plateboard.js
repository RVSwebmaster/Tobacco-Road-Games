import { buildCreatorPlateboardSchedule } from "./creator-plateboard-schedule.mjs";

(() => {
  const wall = document.querySelector("[data-creator-plateboard]");
  if (!wall) return;

  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const previewMotion = localHost && new URLSearchParams(location.search).get("plateboard-preview") === "motion";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const previewItems = readPreviewItems(wall);
  const configuredInterval = positiveInteger(wall.dataset.intervalSeconds, 60);
  const transitFactor = 3;
  let feedItems = [];
  let intervalSeconds = configuredInterval;
  let schedule = [];
  let scheduleDate = "";
  let timer = 0;

  function readPreviewItems(container) {
    return [...container.querySelectorAll("[data-plateboard-preview]")].map(node => ({
      creatorId: node.dataset.creatorId,
      creatorName: node.dataset.creatorName,
      title: node.dataset.title,
      tagline: node.dataset.tagline,
      secondaryCopy: node.dataset.secondaryCopy,
      callout: node.dataset.callout,
      theme: node.dataset.theme,
      creativeUrl: node.dataset.artwork,
      altText: "",
      preview: true
    }));
  }

  async function loadLocalPreviewItems() {
    try {
      const response = await fetch("/data/bb1-creator-ad-preview.json", { cache: "no-store" });
      if (!response.ok) return [];
      const items = await response.json();
      return Array.isArray(items) ? items.map(ad => ({
        creatorId: ad.creatorId,
        creatorName: ad.creator,
        title: ad.title,
        tagline: ad.tagline,
        secondaryCopy: ad.secondaryCopy,
        callout: ad.callout,
        theme: ad.theme,
        creativeUrl: ad.artwork,
        altText: "",
        preview: true
      })) : [];
    } catch {
      return [];
    }
  }

  async function loadFeed() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (previewMotion) {
      feedItems = previewItems.length ? previewItems : await loadLocalPreviewItems();
      intervalSeconds = 5;
      schedule = makeMotionPreview(feedItems, intervalSeconds);
      scheduleDate = utcDateKey(new Date());
      sync();
      return;
    }

    try {
      const response = await fetch("/api/creator-plateboard", { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("The Creator plateboard feed is unavailable.");
      const payload = await response.json();
      feedItems = Array.isArray(payload.items) ? payload.items : [];
      intervalSeconds = positiveInteger(payload.intervalSeconds, configuredInterval);
    } catch {
      feedItems = localHost ? previewItems : [];
      intervalSeconds = configuredInterval;
    }

    const current = new Date();
    if (feedItems.length) intervalSeconds = Math.min(intervalSeconds, Math.max(1, Math.floor(12 * 60 * 60 / feedItems.length)));
    scheduleDate = utcDateKey(current);
    schedule = buildCreatorPlateboardSchedule(feedItems, { date: current, intervalSeconds }).schedule;
    sync();
  }

  function makeMotionPreview(items, interval) {
    if (!items.length) return [];
    const now = Date.now();
    const intervalMs = interval * 1000;
    const currentSlot = Math.floor(now / intervalMs);
    return Array.from({ length: 31 }, (_, index) => {
      const slot = currentSlot - transitFactor + index;
      const ad = items[((slot % items.length) + items.length) % items.length];
      return { creatorId: ad.creatorId, appearance: 1, startsAtMs: slot * intervalMs, ad };
    });
  }

  function sync() {
    const now = Date.now();
    const currentDate = utcDateKey(new Date(now));
    if (currentDate !== scheduleDate) {
      loadFeed();
      return;
    }
    if (previewMotion && (!schedule.length || schedule[schedule.length - 1].startsAtMs - now < 20 * intervalSeconds * 1000)) {
      schedule = makeMotionPreview(feedItems, intervalSeconds);
    }

    const intervalMs = intervalSeconds * 1000;
    const transitMs = intervalMs * transitFactor;
    const active = schedule.filter(item => item.startsAtMs <= now && item.startsAtMs + transitMs > now);
    wall.replaceChildren(...active.map(item => makePoster(item, now, intervalMs, transitMs)));
    wall.dataset.scheduleCapacity = String(Math.floor(12 * 60 * 60 / intervalMs) * 2);
    wall.dataset.scheduleDate = scheduleDate;

    const futureStart = schedule.find(item => item.startsAtMs > now)?.startsAtMs ?? Infinity;
    const nextEnd = active.length ? Math.min(...active.map(item => item.startsAtMs + transitMs)) : Infinity;
    const nextMidnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
    const nextChange = Math.min(futureStart, nextEnd, nextMidnight, now + 60_000);
    timer = setTimeout(sync, Math.max(50, nextChange - now));
  }

  function makePoster(item, now, intervalMs, transitMs) {
    const ad = item.ad;
    const poster = document.createElement("article");
    const theme = ["folk", "frontier", "goblin"].includes(ad.theme) ? ad.theme : "creator";
    poster.className = `bb1-poster bb1-poster--${theme} bb1-poster--scheduled`;
    poster.dataset.creatorId = item.creatorId;
    poster.dataset.appearance = String(item.appearance);
    poster.style.setProperty("--plateboard-transit-duration", `${transitMs}ms`);

    const elapsed = Math.max(0, now - item.startsAtMs);
    if (reducedMotion) {
      const position = Math.min(transitFactor - 1, Math.floor(elapsed / intervalMs));
      poster.style.left = `${position * 100 / transitFactor}%`;
      poster.style.animation = "none";
    } else {
      poster.style.animationDelay = `${-elapsed}ms`;
    }

    const link = document.createElement("a");
    link.className = "bb1-poster__link";
    if (isLocalProductPath(ad.destinationUrl)) link.href = ad.destinationUrl;
    else link.removeAttribute("href");

    const art = document.createElement("img");
    art.className = "bb1-poster__art";
    art.src = ad.creativeUrl;
    art.alt = String(ad.altText || "");
    art.loading = "eager";
    art.decoding = "async";
    art.draggable = false;

    const copy = document.createElement("div");
    copy.className = "bb1-poster__copy";
    const creator = document.createElement("p");
    creator.className = "bb1-poster__creator";
    creator.textContent = String(ad.creatorName || "Tobacco Road Games Creator");
    const title = document.createElement("h3");
    title.textContent = String(ad.title || "Creator product");
    copy.append(creator, title);
    if (ad.tagline) {
      const tagline = document.createElement("p");
      tagline.className = "bb1-poster__tagline";
      tagline.textContent = String(ad.tagline);
      copy.append(tagline);
    }
    if (ad.secondaryCopy) {
      const secondary = document.createElement("p");
      secondary.className = "bb1-poster__secondary";
      secondary.textContent = String(ad.secondaryCopy);
      copy.append(secondary);
    }
    if (ad.callout) {
      const callout = document.createElement("p");
      callout.className = "bb1-poster__callout";
      callout.textContent = String(ad.callout);
      copy.append(callout);
    }

    link.append(art, copy);
    poster.append(link);
    return poster;
  }

  function isLocalProductPath(value) {
    return typeof value === "string" && value.startsWith("/store/products/") && !value.startsWith("//");
  }

  function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3600 ? parsed : fallback;
  }

  function utcDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadFeed();
    else if (timer) { clearTimeout(timer); timer = 0; }
  });

  loadFeed();
})();
