(function attachStorefrontShelfThemes(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TRGStorefrontShelfThemes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStorefrontShelfThemes() {
  "use strict";

  const HOUSE_TIME_ZONE = "America/New_York";
  const ASSET_ROOT = "/assets/images/storefront-shelf-dressing";
  const assetPath = (filename) => `${ASSET_ROOT}/${filename}`;
  const ASSET_SOURCES = Object.freeze({
    plant: assetPath("variegated_pothos_in_ornate_green_urn.webp"),
    "best-seller-trophy": assetPath("antique_golden_book_trophy.webp"),
    dice: assetPath("enchanted_books_and_emerald_dice.webp"),
    knight: assetPath("antique_brass_globe_on_stacked_books.webp"),
    dragon: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    chest: assetPath("enchanted_books_and_emerald_dice.webp"),
    "map-tube": assetPath("vintage_books_and_magnifying_glass.webp"),
    potion: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    "gm-screen": assetPath("vintage_books_and_magnifying_glass.webp"),
    "game-books": assetPath("enchanted_books_and_emerald_dice.webp"),
    "sci-fi": assetPath("antique_brass_globe_on_stacked_books.webp"),
    bookend: assetPath("vintage_books_and_magnifying_glass.webp"),
    "trg-cake": assetPath("antique_golden_book_trophy.webp"),
    ribbon: assetPath("antique_golden_book_trophy.webp"),
    medallion: assetPath("antique_golden_book_trophy.webp"),
    present: assetPath("antique_golden_book_trophy.webp"),
    "party-hat": assetPath("antique_golden_book_trophy.webp"),
    "basketball-trophy": assetPath("basketball_trophy_on_walnut_stand.webp"),
    basketball: assetPath("basketball_trophy_on_walnut_stand.webp"),
    scoreboard: assetPath("basketball_trophy_on_walnut_stand.webp"),
    "field-pack": assetPath("antique_brass_lantern_with_candle_glow.webp"),
    anchor: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    "dress-cap": assetPath("antique_brass_lantern_with_candle_glow.webp"),
    aircraft: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    cutter: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    satellite: assetPath("antique_brass_lantern_with_candle_glow.webp"),
    pumpkin: assetPath("glowing_autumn_jack_o_lantern_harvest_decor.webp"),
    lantern: assetPath("glowing_autumn_jack_o_lantern_harvest_decor.webp"),
    "harvest-pumpkin": assetPath("glowing_autumn_jack_o_lantern_harvest_decor.webp"),
    "autumn-leaves": assetPath("glowing_autumn_jack_o_lantern_harvest_decor.webp"),
    "easter-eggs": assetPath("enchanted_books_and_emerald_dice.webp"),
    sumo: assetPath("cheerful_ceramic_sumo_figurine.webp"),
    uchiwa: assetPath("cheerful_ceramic_sumo_figurine.webp"),
    evergreen: assetPath("frosted_holiday_tree_with_velvet_bow.webp"),
    gift: assetPath("frosted_holiday_tree_with_velvet_bow.webp"),
    holly: assetPath("frosted_holiday_tree_with_velvet_bow.webp"),
    bell: assetPath("frosted_holiday_tree_with_velvet_bow.webp"),
    flowers: assetPath("antique_brass_globe_on_stacked_books.webp"),
    "spring-plant": assetPath("vintage_books_and_magnifying_glass.webp")
  });
  const DEFAULT_THEME = Object.freeze({
    id: "default",
    name: "Default RPG shelf dressing",
    priority: 0,
    enabled: true,
    schedule: { type: "always" },
    decorations: ["dice", "knight", "dragon", "chest", "map-tube", "potion", "gm-screen", "game-books", "sci-fi", "bookend"]
  });

  // Variable-date events remain explicit configuration. Add approved date ranges here;
  // the selector never guesses a launch anniversary, tournament, winner, or Easter date.
  const THEMES = Object.freeze([
    Object.freeze({
      id: "trg-anniversary",
      name: "Tobacco Road Games Birthday / Launch Anniversary",
      priority: 100,
      enabled: false,
      schedule: { type: "annual-date", month: null, day: null },
      configurationNote: "Enable only after the canonical Tobacco Road Games launch anniversary month and day are approved.",
      decorations: ["trg-cake", "ribbon", "medallion", "present", "party-hat"]
    }),
    Object.freeze({
      id: "acc-basketball-winner",
      name: "ACC Tournament Winner",
      priority: 90,
      enabled: false,
      schedule: { type: "date-ranges", ranges: [] },
      configurationNote: "Supply an approved winner treatment and display range before enabling.",
      decorations: ["basketball-trophy"]
    }),
    Object.freeze({ id: "army-birthday", name: "U.S. Army Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 6, day: 14 }, decorations: ["field-pack"] }),
    Object.freeze({ id: "navy-birthday", name: "U.S. Navy Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 10, day: 13 }, decorations: ["anchor"] }),
    Object.freeze({ id: "marine-corps-birthday", name: "U.S. Marine Corps Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 11, day: 10 }, decorations: ["dress-cap"] }),
    Object.freeze({ id: "air-force-birthday", name: "U.S. Air Force Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 9, day: 18 }, decorations: ["aircraft"] }),
    Object.freeze({ id: "coast-guard-birthday", name: "U.S. Coast Guard Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 8, day: 4 }, decorations: ["cutter"] }),
    Object.freeze({ id: "space-force-birthday", name: "U.S. Space Force Birthday", priority: 80, enabled: true, schedule: { type: "annual-date", month: 12, day: 20 }, decorations: ["satellite"] }),
    Object.freeze({ id: "halloween", name: "Halloween", priority: 80, enabled: true, schedule: { type: "annual-date", month: 10, day: 31 }, decorations: ["pumpkin", "lantern"] }),
    Object.freeze({ id: "thanksgiving", name: "Thanksgiving / Harvest", priority: 80, enabled: true, schedule: { type: "nth-weekday", month: 11, weekday: 4, nth: 4 }, decorations: ["harvest-pumpkin", "autumn-leaves"] }),
    Object.freeze({ id: "easter", name: "Easter", priority: 80, enabled: true, schedule: { type: "date-ranges", ranges: [] }, configurationNote: "Add each approved movable-date display range.", decorations: ["easter-eggs"] }),
    Object.freeze({ id: "honbasho", name: "Grand Sumo Honbasho", priority: 60, enabled: true, schedule: { type: "date-ranges", ranges: [] }, configurationNote: "Add official tournament display ranges as the calendar is approved.", decorations: ["sumo", "uchiwa"] }),
    Object.freeze({ id: "acc-basketball", name: "College Basketball / ACC", priority: 60, enabled: true, schedule: { type: "date-ranges", ranges: [] }, configurationNote: "Add approved season or tournament display ranges; no school winner is assumed.", decorations: ["basketball", "scoreboard"] }),
    Object.freeze({ id: "winter-holiday", name: "Christmas / Winter Holiday", priority: 40, enabled: true, schedule: { type: "annual-range", start: "12-15", end: "01-05" }, decorations: ["evergreen", "gift", "holly", "bell"] }),
    Object.freeze({ id: "spring", name: "Spring", priority: 20, enabled: true, schedule: { type: "annual-range", start: "03-20", end: "05-31" }, decorations: ["flowers", "spring-plant"] }),
    Object.freeze({ id: "autumn", name: "Autumn", priority: 20, enabled: true, schedule: { type: "annual-range", start: "09-22", end: "11-30" }, decorations: ["autumn-leaves", "harvest-pumpkin"] }),
    DEFAULT_THEME
  ]);

  const DEFAULT_PAIRS = Object.freeze([
    ["dice", "dragon"],
    ["knight", "potion"],
    ["map-tube", "chest"],
    ["potion", "gm-screen"],
    ["game-books", "sci-fi"],
    ["bookend", "dice"]
  ]);

  function houseDateParts(value = new Date()) {
    const instant = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: HOUSE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(instant);
    const read = (type) => Number(parts.find((part) => part.type === type)?.value);
    return { year: read("year"), month: read("month"), day: read("day") };
  }

  function dateKey(parts) {
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function isScheduleActive(schedule, parts) {
    if (!schedule) return false;
    if (schedule.type === "always") return true;
    if (schedule.type === "annual-date") return Number(schedule.month) === parts.month && Number(schedule.day) === parts.day;
    if (schedule.type === "annual-range") {
      const current = `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      return schedule.start <= schedule.end
        ? current >= schedule.start && current <= schedule.end
        : current >= schedule.start || current <= schedule.end;
    }
    if (schedule.type === "nth-weekday") {
      if (Number(schedule.month) !== parts.month) return false;
      const firstWeekday = new Date(Date.UTC(parts.year, parts.month - 1, 1)).getUTCDay();
      const targetDay = 1 + ((Number(schedule.weekday) - firstWeekday + 7) % 7) + ((Number(schedule.nth) - 1) * 7);
      return parts.day === targetDay;
    }
    if (schedule.type === "date-ranges") {
      const current = dateKey(parts);
      return (schedule.ranges || []).some((range) => current >= range.start && current <= range.end);
    }
    return false;
  }

  function selectActiveTheme(value = new Date(), manifest = THEMES) {
    const parts = houseDateParts(value);
    const candidates = manifest
      .filter((theme) => theme.enabled !== false && isScheduleActive(theme.schedule, parts))
      .map((theme, index) => ({ theme, index }))
      .sort((left, right) => (Number(right.theme.priority) - Number(left.theme.priority)) || (left.index - right.index));
    return candidates[0]?.theme || DEFAULT_THEME;
  }

  function defaultDecoration(shelfIndex, side) {
    const pair = DEFAULT_PAIRS[Math.abs(Number(shelfIndex) || 0) % DEFAULT_PAIRS.length];
    return pair[side === "left" ? 0 : 1];
  }

  function eventDecoration(theme, shelfIndex, shelfKey) {
    const shelfSpecific = theme.shelfVariations?.[shelfKey];
    const choices = shelfSpecific?.length ? shelfSpecific : theme.decorations;
    return choices[Math.abs(Number(shelfIndex) || 0) % choices.length];
  }

  function objectDescriptor(asset, kind = "default") {
    return Object.freeze({ asset, kind, src: ASSET_SOURCES[asset] || ASSET_SOURCES["game-books"] });
  }

  function sideDescriptor(secondaryAsset, secondaryKind = "default") {
    return Object.freeze({
      plant: objectDescriptor("plant", "plant"),
      secondary: objectDescriptor(secondaryAsset, secondaryKind)
    });
  }

  function resolveShelfDressing({ shelfIndex = 0, shelfKey = "", theme = DEFAULT_THEME } = {}) {
    const isOpenRules = shelfKey === "open-rules";
    const isEvent = theme.id !== DEFAULT_THEME.id;
    const eventSide = isEvent && !isOpenRules ? (shelfIndex % 2 === 0 ? "right" : "left") : null;
    let leftSecondary = objectDescriptor(defaultDecoration(shelfIndex, "left"));
    let rightSecondary = objectDescriptor(defaultDecoration(shelfIndex, "right"));

    if (eventSide) {
      const eventObject = objectDescriptor(eventDecoration(theme, shelfIndex, shelfKey), "event");
      if (eventSide === "left") leftSecondary = eventObject;
      else rightSecondary = eventObject;
    }

    if (isOpenRules) {
      leftSecondary = objectDescriptor("best-seller-trophy", "house");
      rightSecondary = objectDescriptor("best-seller-trophy", "house");
    }

    return Object.freeze({
      themeId: theme.id,
      eventSide,
      left: sideDescriptor(leftSecondary.asset, leftSecondary.kind),
      right: sideDescriptor(rightSecondary.asset, rightSecondary.kind)
    });
  }

  return Object.freeze({
    HOUSE_TIME_ZONE,
    ASSET_ROOT,
    ASSET_SOURCES,
    DEFAULT_THEME,
    THEMES,
    houseDateParts,
    isScheduleActive,
    selectActiveTheme,
    resolveShelfDressing
  });
});
