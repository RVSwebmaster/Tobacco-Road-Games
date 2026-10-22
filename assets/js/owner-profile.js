(() => {
  const root = document.querySelector("[data-owner-profile]");
  if (!root) return;
  const status = root.querySelector("[data-profile-status]");
  const libraryChoices = root.querySelector("[data-library-choices]");
  const shelfChoices = root.querySelector("[data-shelf-choices]");
  const catalog = root.querySelector("[data-catalog]");
  const community = root.querySelector("[data-community]");
  const appearanceForm = root.querySelector("[data-appearance-form]");
  const posterForm = root.querySelector("[data-poster-form]");
  let profile;

  load().catch((error) => setStatus(error.message, true));

  async function load() {
    const response = await fetch("/owner/api/profile", { headers: { accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Owner Profile could not be loaded.");
    profile = payload;
    render();
    try { localStorage.setItem("trg-owner-library-shelves", "enabled"); } catch { /* Server-side persistence remains authoritative. */ }
    setStatus("Owner Profile loaded.");
  }

  function render() {
    if (!profile.configured) { setStatus("RV Sawyer's Creator identity is not linked to an account.", true); return; }
    renderLibrary();
    renderCatalog();
    renderShelf();
    renderCommunity();
    renderAppearance();
    renderPosters();
    applyAppearance(profile.appearance);
  }

  function renderLibrary() {
    if (!profile.purchases.length) { libraryChoices.innerHTML = '<p class="shelf-empty">No entitled purchases are currently associated with RV Sawyer’s linked account.</p>'; return; }
    libraryChoices.innerHTML = profile.purchases.map((item) => choice("library", item.productSlug, item.productTitle, item.selected, `${item.purchasedVersion || "Purchased edition"} · ${item.orderReference}`)).join("");
  }

  function renderCatalog() {
    catalog.innerHTML = profile.catalog.length ? profile.catalog.map((item) => `<article class="owner-profile__card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.lifecycleState)} · ${escapeHtml(item.publicationState)}</p><div class="hero__actions"><a class="button button--secondary" href="/owner/product-intake.html?listing=${encodeURIComponent(item.id)}">Manage Listing</a>${item.publicProductSlug ? `<a class="button button--secondary" href="/store/products/${encodeURIComponent(item.publicProductSlug)}/" target="_blank" rel="noopener">View Product</a>` : ""}</div></article>`).join("") : '<p class="shelf-empty">RV Sawyer has no Creator listings in this environment.</p>';
  }

  function renderShelf() {
    const selected = new Set(profile.shelved.map((item) => item.id));
    const eligible = profile.catalog.filter((item) => item.lifecycleState === "active" && item.publicationState === "published");
    shelfChoices.innerHTML = eligible.length ? eligible.map((item) => choice("shelf", item.id, item.title, selected.has(item.id), `${item.publicProductSlug || item.slug}`)).join("") : '<p class="shelf-empty">No published, saleable RV Sawyer products are available for the public profile shelf.</p>';
  }

  function renderCommunity() {
    const forum = profile.community.forumProfile;
    community.innerHTML = `<a class="browse-card" href="/forum"><strong>Forum Participation</strong><span>${forum ? `${escapeHtml(forum.handle)} · ${forum.topicCount} topics · ${forum.replyCount} posts` : "No linked public forum profile."}</span></a><a class="browse-card" href="/owner/discussions.html"><strong>Public Creator Messages</strong><span>Manage the implemented public author-discussion system.</span></a><article class="owner-profile__card"><h3>Private Messages</h3><p>Private account messaging is not yet implemented.</p></article><article class="owner-profile__card"><h3>Customer Rewards</h3><p>Customer rewards are not yet implemented.</p></article>`;
  }

  function renderAppearance() {
    const settings = profile.appearance;
    appearanceForm.elements.appearanceMode.value = settings.appearanceMode;
    appearanceForm.elements.wallpaperKind.value = settings.wallpaperKind;
    appearanceForm.elements.wallpaperSaturation.value = settings.wallpaperSaturation;
    fillWallpaperOptions(settings.wallpaperKind, settings.wallpaperKey);
    updateSaturation();
  }

  function fillWallpaperOptions(kind, selected) {
    const manifest = kind === "prepared" ? profile.manifests.preparedWallpapers : profile.manifests.palette;
    const labels = { walnut: "Walnut", moss: "Moss Green", parchment: "Parchment", midnight: "Midnight Blue", oxblood: "Oxblood", "trg-classic": "Tobacco Road Games Classic" };
    const select = appearanceForm.elements.wallpaperKey;
    select.innerHTML = Object.keys(manifest).map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(labels[key] || key)}</option>`).join("");
    select.value = manifest[selected] ? selected : Object.keys(manifest)[0];
  }

  function renderPosters() {
    const entries = Object.keys(profile.manifests.posterAssets);
    root.querySelectorAll("[data-poster-select]").forEach((select) => { select.innerHTML = '<option value="">No poster</option>' + entries.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(titleCase(key))}</option>`).join(""); });
    const first = profile.posters.find((item) => item.slot === 1), second = profile.posters.find((item) => item.slot === 2);
    posterForm.elements.poster1.value = first?.assetKey || "";
    posterForm.elements.poster1Alt.value = first?.altText || "";
    posterForm.elements.poster2.value = second?.assetKey || "";
    posterForm.elements.poster2Alt.value = second?.altText || "";
    renderPosterPreview();
  }

  root.querySelector("[data-save-library]").addEventListener("click", () => save("save_library", { productSlugs: checked("library") }, profile.limits.library));
  root.querySelector("[data-save-shelf]").addEventListener("click", () => save("save_shelf", { listingIds: checked("shelf") }, profile.limits.shelf));
  appearanceForm.addEventListener("submit", (event) => { event.preventDefault(); save("save_appearance", { appearanceMode: appearanceForm.elements.appearanceMode.value, wallpaperKind: appearanceForm.elements.wallpaperKind.value, wallpaperKey: appearanceForm.elements.wallpaperKey.value, wallpaperSaturation: Number(appearanceForm.elements.wallpaperSaturation.value) }); });
  appearanceForm.elements.wallpaperKind.addEventListener("change", () => fillWallpaperOptions(appearanceForm.elements.wallpaperKind.value, ""));
  appearanceForm.elements.wallpaperSaturation.addEventListener("input", updateSaturation);
  posterForm.addEventListener("submit", (event) => { event.preventDefault(); save("save_posters", { posters: [{ assetKey: posterForm.elements.poster1.value, altText: posterForm.elements.poster1Alt.value }, { assetKey: posterForm.elements.poster2.value, altText: posterForm.elements.poster2Alt.value }] }); });
  posterForm.addEventListener("change", renderPosterPreview);

  async function save(action, values, maximum) {
    if (maximum && Object.values(values)[0].length > maximum) { setStatus(`Choose no more than ${maximum} items.`, true); return; }
    const csrf = cookie("trg_owner_csrf");
    if (!csrf) { setStatus("The Owner security token is missing. Reload the page.", true); return; }
    setStatus("Saving…");
    try {
      const response = await fetch("/owner/api/profile", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ action, ...values }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setStatus(payload.error || "The profile could not be saved.", true); return; }
      profile = payload.profile;
      render();
      setStatus("Owner Profile saved.");
    } catch {
      setStatus("The profile could not be saved because the staging service did not respond.", true);
    }
  }

  function choice(group, value, title, selected, note) { return `<label class="owner-profile__choice"><input type="checkbox" name="${group}" value="${escapeHtml(value)}"${selected ? " checked" : ""}><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note)}</small></span></label>`; }
  function checked(name) { return [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value); }
  function applyAppearance(settings) { root.dataset.appearance = settings.appearanceMode; root.style.setProperty("--profile-wallpaper-color", settings.wallpaperColor); root.style.setProperty("--profile-wallpaper-image", settings.wallpaperUrl ? `url("${settings.wallpaperUrl}")` : "none"); root.style.setProperty("--profile-wallpaper-saturation", `${settings.wallpaperSaturation}%`); }
  function updateSaturation() { root.querySelector("[data-saturation-output]").value = `${appearanceForm.elements.wallpaperSaturation.value}%`; }
  function renderPosterPreview() { const keys = [posterForm.elements.poster1.value, posterForm.elements.poster2.value].filter(Boolean); root.querySelector("[data-poster-preview]").innerHTML = keys.map((key) => `<img src="${escapeHtml(profile.manifests.posterAssets[key])}" alt="">`).join(""); }
  function setStatus(message, error = false) { status.textContent = message; status.dataset.state = error ? "error" : "ok"; }
  function cookie(name) { const prefix = `${name}=`; return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) || ""; }
  function titleCase(value) { return String(value).split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
})();
