(() => {
  const root = document.querySelector("[data-public-creator-profile]");
  if (!root) return;
  const slug = root.dataset.publicCreatorProfile;
  fetch(`/api/public-profile/${encodeURIComponent(slug)}`, { headers: { accept: "application/json" }, cache: "no-store" })
    .then(async (response) => { const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || "Profile unavailable."); return payload; })
    .then(render)
    .catch(() => { /* Static public profile remains the complete fallback. */ });

  function render(profile) {
    const appearance = profile.appearance || {};
    root.dataset.appearance = appearance.appearanceMode || "night";
    root.style.setProperty("--profile-wallpaper-color", appearance.wallpaperColor || "#20150f");
    root.style.setProperty("--profile-wallpaper-image", appearance.wallpaperUrl ? `url("${appearance.wallpaperUrl}")` : "none");
    root.style.setProperty("--profile-wallpaper-saturation", `${Number(appearance.wallpaperSaturation) || 100}%`);
    const shelf = root.querySelector("[data-public-profile-shelf]");
    if (shelf) shelf.innerHTML = profile.shelved?.length ? profile.shelved.map(productCard).join("") : '<p class="shelf-empty">No products are currently selected for this Creator shelf.</p>';
    const posters = root.querySelector("[data-public-profile-posters]");
    if (posters) {
      posters.innerHTML = profile.posters?.length ? profile.posters.map((poster) => `<figure class="creator-profile-poster"><img src="${escapeHtml(poster.assetUrl)}" alt="${escapeHtml(poster.altText)}"></figure>`).join("") : "";
      posters.hidden = !profile.posters?.length;
    }
  }

  function productCard(item) {
    return `<a class="browse-card" href="${escapeHtml(item.url)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.shortDescription || "Published by RV Sawyer")}</span></a>`;
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
})();
