const trgStoreUrl = "https://www.drivethrurpg.com/en/publisher/13450/russell-sawyer";

// Mark exactly one release with featured: true to control the homepage spotlight.
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
    storeUrl: "https://www.drivethrurpg.com/product/566183/Monster-Deaths-and-Making-It-Count"
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
    featured: true,
    category: "Player option",
    group: "Player Options",
    image: "assets/releases/thiefcraft-cover.png",
    imageAlt: "Thiefcraft cover art showing multiple rogue paths in a dark fantasy style.",
    featureEyebrow: "Featured Product",
    featureSubtitle: "A 5E-Compatible Rogue Supplement for 2014-Era Rules",
    featureHook: "One task. One roll. Clear stakes. Real consequences.",
    featureDescription:
      "Thiefcraft gives rogues, burglars, scouts, cutpurses, infiltrators, and other shadow-working characters a sharper place at the table. It turns risky work into meaningful play with cleaner procedures, clearer consequences, and tools that make criminal expertise feel dangerous, deliberate, and worth doing.",
    featureSupport:
      "Built for 2014-era 5E play, Thiefcraft is for tables that want rogue work to matter without bogging the session down in mushy procedure.",
    hook: "Rogue work with clearer procedure, sharper stakes, and consequences that actually bite.",
    description:
      "Player-facing material for tables that want thief characters to feel clever, specific, and mechanically alive instead of generically slippery.",
    storeUrl: "https://www.drivethrurpg.com/product/567896/Thiefcraft"
  },
  {
    title: "The Yojimbo Fighter Martial Archetype",
    category: "Martial archetype",
    group: "Player Options",
    hook: "A fighter path with a duelist's edge and a bodyguard's sense of duty.",
    description:
      "A martial archetype built for characters who live between service, steel, and hard choices, with a strong player-facing identity at the table.",
    storeUrl: "https://www.drivethrurpg.com/product/568030/The-Yojimbo-Fighter-Martial-Archetype"
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

function getFeaturedRelease(releases) {
  const featuredReleases = releases.filter((release) => release.featured);

  if (featuredReleases.length > 1) {
    console.warn("Only one release should be marked featured: true. Using the first one.");
  }

  return featuredReleases[0] || releases[0];
}

function renderFeaturedRelease(release) {
  const featuredRoot = document.getElementById("featured-release");

  if (!featuredRoot || !release) {
    return;
  }

  const imageMarkup = release.image
    ? `
      <div class="feature-card__media">
        <div class="feature-card__frame">
          <img src="${escapeAttribute(release.image)}" alt="${escapeAttribute(release.imageAlt || release.title)}">
        </div>
      </div>
    `
    : "";

  featuredRoot.innerHTML = `
    <article class="feature-card">
      ${imageMarkup}
      <div class="feature-card__copy">
        <p class="feature-card__eyebrow">${escapeHtml(release.featureEyebrow || "Featured Product")}</p>
        <h3>${escapeHtml(release.title)}</h3>
        <p class="feature-card__subtitle">${escapeHtml(release.featureSubtitle || release.category)}</p>
        <p class="feature-card__hook">${escapeHtml(release.featureHook || release.hook)}</p>
        <p class="feature-card__body">${escapeHtml(release.featureDescription || release.description)}</p>
        ${release.featureSupport ? `<p class="feature-card__support">${escapeHtml(release.featureSupport)}</p>` : ""}
        <div class="feature-card__actions">
          <a class="button button--primary" href="${escapeAttribute(release.storeUrl)}" target="_blank" rel="noopener noreferrer">View ${escapeHtml(release.title)}</a>
          <a class="button button--secondary" href="${escapeAttribute(trgStoreUrl)}" target="_blank" rel="noopener noreferrer">Browse the Store</a>
        </div>
      </div>
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
              <a class="button button--primary" href="${escapeAttribute(release.storeUrl)}" target="_blank" rel="noopener noreferrer">Store page</a>
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
  renderFeaturedRelease(getFeaturedRelease(trgReleases));
  renderReleaseGroups(trgReleases);
});
