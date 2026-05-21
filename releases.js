const trgReleases = [
  {
    title: "BDSF: Rolling the Bones",
    category: "Game line",
    group: "Game Lines and Systems",
    hook: "A BDSF release for tables that like risk, momentum, and a little grit in the machine.",
    description:
      "Part of the BDSF line, built for play that wants motion, consequence, and a system that earns its bruises at the table.",
    storeUrl: "https://www.drivethrurpg.com/en/product/568410"
  },
  {
    title: "BDSF: Core Rules Omnibus",
    category: "System core",
    group: "Game Lines and Systems",
    hook: "The omnibus spine of the BDSF line, gathered for people who want the engine in one place.",
    description:
      "A core-rules release meant to put the larger line on firmer footing, with the workshop's system-minded design out in the open.",
    storeUrl: "https://www.drivethrurpg.com/en/product/568030"
  },
  {
    title: "Personal Milestones",
    category: "Character growth",
    group: "Player Options",
    hook: "Character advancement with more personality than a simple level-up checkbox.",
    description:
      "A player-facing tool for growth, development, and earned progress, shaped for campaigns where character change should feel lived in.",
    storeUrl: "https://www.drivethrurpg.com/en/product/567896"
  },
  {
    title: "Backyard Troopers - Basic",
    category: "Action game",
    group: "Game Lines and Systems",
    hook: "A compact battlefield with toy-box energy and live-fire table instincts.",
    description:
      "A basic entry point for Backyard Troopers, aimed at groups who like action, pressure, and a little rough-edged imagination in the field kit.",
    storeUrl: "https://www.drivethrurpg.com/en/product/566417"
  },
  {
    title: "Monster Deaths and Making It Count",
    category: "GM tool",
    group: "GM Tools",
    hook: "Stop letting monster deaths land like bookkeeping receipts.",
    description:
      "A practical piece on visible wounds, morale, retreat, and final blows, for Game Masters who want combat endings to feel earned.",
    storeUrl: "https://www.drivethrurpg.com/en/product/552690"
  },
  {
    title: "Heirlooms & Reveries",
    category: "GM tool",
    group: "GM Tools",
    hook: "Cherished objects, places, and traditions that carry emotional weight into play.",
    description:
      "A worldbuilding tool for bringing memory, inheritance, and subtle narrative magic into a fantasy campaign without flattening them into loot.",
    storeUrl: "https://www.drivethrurpg.com/en/product/290255"
  },
  {
    title: "Thiefcraft",
    category: "Player option",
    group: "Player Options",
    hook: "Roguish play with more intent than just 'I roll Stealth again.'",
    description:
      "Player-facing material for tables that want thief characters to feel clever, specific, and mechanically alive instead of generically slippery.",
    storeUrl: "https://www.drivethrurpg.com/en/product/267904"
  },
  {
    title: "The Yojimbo Fighter Martial Archetype",
    category: "Martial archetype",
    group: "Player Options",
    hook: "A fighter path with a duelist's edge and a bodyguard's sense of duty.",
    description:
      "A martial archetype built for characters who live between service, steel, and hard choices, with a strong player-facing identity at the table.",
    storeUrl: "https://www.drivethrurpg.com/en/product/249802"
  }
];

const releaseGroupOrder = [
  {
    name: "GM Tools",
    intro: "Advice, procedures, and encounter-minded support for the person running the world."
  },
  {
    name: "Player Options",
    intro: "Character-facing material for players who want sharper choices and stronger identity."
  },
  {
    name: "Adventures and Scenarios",
    intro: "Setups, trouble, weather, and bad ideas waiting for a table to light the fuse."
  },
  {
    name: "Game Lines and Systems",
    intro: "Broader game frameworks, line support, and system material with workshop bones."
  }
];

function renderLatestRelease(release) {
  const latestRoot = document.getElementById("latest-release");

  if (!latestRoot || !release) {
    return;
  }

  latestRoot.innerHTML = `
    <article class="latest-card">
      <div class="latest-card__copy">
        <p class="latest-card__meta">${escapeHtml(release.category)} | Latest release</p>
        <h3>${escapeHtml(release.title)}</h3>
        <p class="latest-card__hook">${escapeHtml(release.hook)}</p>
        <p class="latest-card__body">${escapeHtml(release.description)}</p>
        <div class="latest-card__actions">
          <a class="button button--primary" href="${escapeAttribute(release.storeUrl)}" target="_blank" rel="noreferrer">Store page</a>
          <a class="button button--secondary" href="#releases">View all releases</a>
        </div>
      </div>
      <aside class="latest-card__sidebar">
        <p class="latest-card__sidebar-label">Why it belongs here</p>
        <p>This section always pulls the first item from the release list, so updating the newest release means moving one entry to the top.</p>
      </aside>
    </article>
  `;
}

function renderReleaseGroups(releases) {
  const groupsRoot = document.getElementById("release-groups");

  if (!groupsRoot) {
    return;
  }

  const groupedMarkup = releaseGroupOrder
    .map((group) => {
      const items = releases.filter((release) => release.group === group.name);

      if (!items.length) {
        return "";
      }

      const cards = items
        .map(
          (release) => `
            <article class="release-card">
              <p class="release-card__meta">${escapeHtml(release.category)}</p>
              <h4>${escapeHtml(release.title)}</h4>
              <p class="release-card__hook">${escapeHtml(release.hook)}</p>
              <p class="release-card__body">${escapeHtml(release.description)}</p>
              <a class="button button--primary" href="${escapeAttribute(release.storeUrl)}" target="_blank" rel="noreferrer">Store page</a>
            </article>
          `
        )
        .join("");

      return `
        <section class="release-group">
          <div class="release-group__header">
            <p class="release-group__label">${escapeHtml(group.name)}</p>
            <h3 class="release-group__title">${escapeHtml(group.name)}</h3>
            <p class="release-group__intro">${escapeHtml(group.intro)}</p>
          </div>
          <div class="release-grid">
            ${cards}
          </div>
        </section>
      `;
    })
    .join("");

  groupsRoot.innerHTML = groupedMarkup;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

window.addEventListener("DOMContentLoaded", () => {
  renderLatestRelease(trgReleases[0]);
  renderReleaseGroups(trgReleases);
});
