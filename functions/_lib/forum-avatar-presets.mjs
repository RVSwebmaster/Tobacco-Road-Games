export const FORUM_AVATAR_PRESETS = Object.freeze([
  ["brass-d20", "Brass twenty-sided die"],
  ["blue-dragon", "Blue dragon head"],
  ["campfire", "Campfire beneath the stars"],
  ["castle-tower", "Stone castle tower"],
  ["crystal-orb", "Purple crystal orb"],
  ["green-potion", "Green potion bottle"],
  ["knight-helm", "Silver knight helmet"],
  ["map-compass", "Compass on an adventure map"],
  ["mimic-chest", "Friendly mimic treasure chest"],
  ["moon-owl", "Owl beneath a crescent moon"],
  ["red-wizard", "Red-robed wizard"],
  ["rune-stone", "Glowing blue rune stone"],
  ["shield-rose", "Rose-emblazoned shield"],
  ["tavern-mug", "Foaming tavern mug"],
  ["tiny-griffin", "Small golden griffin"],
  ["woodland-ranger", "Green-hooded woodland ranger"]
].map(([id, label]) => Object.freeze({ id, label, url: `/assets/forum-avatars/${id}.svg` })));

const BY_ID = new Map(FORUM_AVATAR_PRESETS.map((preset) => [preset.id, preset]));
export function getForumAvatarPreset(id) { return BY_ID.get(String(id || "")) || null; }
