const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = DAY_MS / 2;

export function buildCreatorPlateboardSchedule(ads, { date = new Date(), intervalSeconds = 60 } = {}) {
  const interval = Number(intervalSeconds);
  if (!Number.isInteger(interval) || interval < 1 || interval > 3600) {
    throw new TypeError("Plateboard interval must be a whole number of seconds from 1 to 3600.");
  }

  const day = date instanceof Date ? date : new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime())) throw new TypeError("Plateboard date is invalid.");
  const startOfDay = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const dateKey = new Date(startOfDay).toISOString().slice(0, 10);
  const intervalMs = interval * 1000;
  const positionsPerHalfDay = Math.floor(HALF_DAY_MS / intervalMs);
  const capacity = positionsPerHalfDay * 2;
  const creators = new Map();

  for (const ad of ads || []) {
    const creatorId = String(ad?.creatorId || "").trim();
    if (!creatorId) throw new TypeError("Every plateboard advertisement needs a Creator ID.");
    if (creators.has(creatorId)) throw new TypeError(`Plateboard feed contains more than one advertisement for Creator ${creatorId}.`);
    creators.set(creatorId, ad);
  }

  if (creators.size > positionsPerHalfDay) {
    return { date: dateKey, intervalSeconds: interval, capacity, capacityExceeded: true, schedule: [] };
  }

  const ordered = [...creators.entries()].sort(([left], [right]) => {
    const leftHash = stableHash(`${dateKey}:${left}`);
    const rightHash = stableHash(`${dateKey}:${right}`);
    return leftHash - rightHash || left.localeCompare(right);
  });
  const schedule = [];

  ordered.forEach(([creatorId, ad], index) => {
    const firstSlot = Math.floor(index * positionsPerHalfDay / ordered.length);
    for (let appearance = 1; appearance <= 2; appearance += 1) {
      const slot = firstSlot + (appearance - 1) * positionsPerHalfDay;
      schedule.push({
        creatorId,
        appearance,
        startsAtMs: startOfDay + slot * intervalMs,
        ad
      });
    }
  });

  schedule.sort((left, right) => left.startsAtMs - right.startsAtMs || left.creatorId.localeCompare(right.creatorId));
  return { date: dateKey, intervalSeconds: interval, capacity, capacityExceeded: false, schedule };
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
