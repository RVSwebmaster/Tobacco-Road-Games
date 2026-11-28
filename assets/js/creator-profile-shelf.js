(() => {
  const publicRoots = Array.from(document.querySelectorAll("[data-public-creator-shelf]"));
  const memberRoot = document.querySelector("[data-member-creator-shelf]");
  const catalog = document.querySelector("[data-creator-profile-catalog]");
  const publicCatalog = document.querySelector("[data-public-creator-catalog]");
  const publicInfo = document.querySelector("[data-public-creator-info]");
  const memberInfo = document.querySelector("[data-member-creator-info]");
  if (!publicRoots.length && !memberRoot && !publicCatalog) return;

  const cache = "no-store";
  const createCatalogSlots = window.createCreatorProfileCatalogSlots;
  const sortCreatorCatalog = window.sortCreatorProfileCatalog;
  const createMemberShelfBooks = window.createCreatorProfileMemberShelfBooks;
  const accountClasses = new Set(["creator", "founding25", "premiumCreator"]);
  let currentRequest = 0;
  let saving = false;
  let csrfToken = "";
  let selectedCreator = null;
  let loadedState = null;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createBook(product) {
    const template = document.querySelector("[data-creator-profile-book-template]");
    const link = template?.content.firstElementChild.cloneNode(true);
    if (!link) return node("span", "bookshelf-book");
    link.href = product.detailUrl;
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.querySelectorAll(".bookshelf-book__title, .bookshelf-book__mobile-title, .bookshelf-book__details strong")
      .forEach(title => { title.textContent = product.title; });
    link.querySelectorAll(".bookshelf-book__author, .bookshelf-book__creator")
      .forEach(author => { author.textContent = product.creatorName || ""; });
    link.querySelectorAll(".bookshelf-book__subtitle, .bookshelf-book__mobile-subtitle")
      .forEach(subtitle => { subtitle.textContent = product.subtitle || ""; });
    link.querySelectorAll(".bookshelf-book__cover").forEach(image => {
      image.src = product.coverUrl || "/assets/tobacco-road-games-logo.png";
      image.alt = image.closest(".bookshelf-book__mobile-media") ? "" : `${product.title} cover`;
    });
    return link;
  }

  function renderBooks(root, products) {
    if (!root) return;
    const shelf = root.querySelector("[data-creator-profile-shelf-books]");
    if (!shelf) return;
    shelf.replaceChildren(...products.map(createBook));
    root.hidden = false;
  }

  function renderMemberShelf(state, creator) {
    const creatorName = String(creator?.name || selectedCreator?.displayName || selectedCreator?.name || "");
    renderBooks(memberRoot, createMemberShelfBooks ? createMemberShelfBooks(state?.products, creatorName) : []);
  }

  function renderPublicCatalog(root, products) {
    if (!root) return;
    const cards = root.querySelector("[data-public-creator-catalog-cards]");
    const empty = root.querySelector("[data-public-creator-catalog-empty]");
    if (!cards) return;
    const sort = root.querySelector("[data-catalog-sort]")?.value || "title-asc";
    const filter = root.querySelector("[data-catalog-filter]")?.value || "all";
    const visible = sortCreatorCatalog
      ? sortCreatorCatalog(products, sort, filter)
      : products.filter(product => filter === "all" || (filter === "shelved" ? product.shelved : !product.shelved));
    cards.replaceChildren(...visible.map(product => {
      const card = node("article", "creator-profile-public-card");
      const link = node("a", "creator-profile-public-card__link");
      link.href = product.detailUrl;
      link.setAttribute("aria-label", `View ${product.title}`);
      const image = node("img", "creator-profile-public-card__cover");
      image.src = product.coverUrl || "/assets/tobacco-road-games-logo.png";
      image.alt = `${product.title} cover`;
      image.loading = "lazy";
      image.decoding = "async";
      link.append(image, node("h3", "creator-profile-public-card__title", product.title));
      if (product.subtitle) link.append(node("p", "creator-profile-public-card__subtitle", product.subtitle));
      card.append(link);
      return card;
    }));
    if (empty) empty.hidden = visible.length > 0;
  }

  function renderCreatorInfo(root, creator, fallback = {}) {
    if (!root) return;
    const image = root.querySelector("[data-creator-info-image]");
    const name = root.querySelector("[data-creator-info-name]");
    const bio = root.querySelector("[data-creator-info-bio]");
    const message = root.querySelector("[data-creator-info-message]");
    const profile = creator || {};
    const base = {
      name: name?.textContent || "",
      longBio: bio?.textContent || "",
      profileImage: image && !image.hidden ? image.getAttribute("src") || "" : "",
      ...fallback
    };
    const displayName = String(profile.name || profile.displayName || base.name || "").trim();
    const bioText = String(profile.longBio || profile.shortBio || base.longBio || base.shortBio || "").trim();
    const imageUrl = root.hasAttribute("data-member-creator-info")
      ? ""
      : String(profile.profileImage || profile.logo || base.profileImage || base.logo || "").trim();
    if (name && displayName) name.textContent = displayName;
    if (bio) bio.textContent = bioText;
    if (image) {
      image.hidden = !imageUrl;
      if (imageUrl) {
        image.src = imageUrl;
        image.alt = `${displayName || "Creator"} profile image`;
      }
    }
    const personalMessage = String(profile.personalMessage || "").trim();
    if (message) {
      message.textContent = personalMessage;
      message.hidden = !personalMessage;
    }
    root.hidden = !(displayName || bioText || imageUrl || personalMessage);
  }

  async function loadPublicProfile(root, creatorSlug, catalogRoot = publicCatalog, infoRoot = publicInfo) {
    if (!creatorSlug) return;
    try {
      const response = await fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(creatorSlug)}`, {
        credentials: "omit", cache
      });
      const payload = response.ok ? await response.json() : null;
      if (root !== memberRoot || !loadedState) renderBooks(root, payload?.products || []);
      if (catalogRoot) catalogRoot._products = payload?.catalog || [];
      renderPublicCatalog(catalogRoot, payload?.catalog || []);
      renderCreatorInfo(infoRoot, payload?.creator);
    } catch {
      if (root !== memberRoot || !loadedState) renderBooks(root, []);
      if (catalogRoot) catalogRoot._products = [];
      renderPublicCatalog(catalogRoot, []);
      renderCreatorInfo(infoRoot, null);
    }
  }

  publicRoots.forEach(root => loadPublicProfile(root, root.dataset.publicCreatorShelf));
  if (!publicRoots.length && publicCatalog) {
    loadPublicProfile(null, publicCatalog.dataset.publicCreatorCatalog, publicCatalog, publicInfo);
  }
  publicCatalog?.querySelectorAll("[data-catalog-sort], [data-catalog-filter]").forEach(control => {
    control.addEventListener("change", () => renderPublicCatalog(publicCatalog, publicCatalog._products || []));
  });
  if (!memberRoot || !catalog) return;

  const cards = catalog.querySelector("[data-creator-profile-catalog-cards]");
  const counters = catalog.querySelector("[data-creator-shelf-counters]");
  const status = catalog.querySelector("[data-creator-shelf-status]");

  function allowance(label, state) {
    const max = state.limit === null ? "Unlimited" : state.limit;
    return `${label}: ${state.used} / ${max}`;
  }

  function renderCounters(state) {
    counters.replaceChildren(
      node("p", "creator-profile-shelf-counter", allowance("Catalog", state.catalog)),
      node("p", "creator-profile-shelf-counter", allowance("Shelf", state.shelf))
    );
  }

  function selectedIds() {
    return Array.from(cards.querySelectorAll("input[data-profile-shelved]:checked"), control => control.dataset.productId);
  }

  function renderCatalogCards(state) {
    const fragment = document.createDocumentFragment();
    const products = state.products || [];
    const capacity = state.catalog.limit === null ? products.length : Math.max(products.length, state.catalog.limit);
    const slots = createCatalogSlots(products, state.catalog.limit, capacity);
    for (const { index, product } of slots) {
      const slot = node("div", "creator-profile-catalog-slot");
      const card = node("article", `creator-profile-catalog-card${product ? "" : " creator-profile-catalog-card--empty"}`);
      const link = product ? node("a", "creator-profile-catalog-card__link") : null;
      if (link) link.href = product.detailUrl;
      if (product?.coverImage) {
        const media = node("div", "product-card__media");
        const image = node("img", "creator-profile-catalog-card__cover");
        image.src = product.coverImage;
        image.alt = `${product.title} cover`;
        image.loading = "lazy";
        image.decoding = "async";
        media.append(image);
        link.append(media);
      } else {
        const cover = node("div", "creator-profile-catalog-card__cover");
        if (link) link.append(cover);
        else card.append(cover);
      }
      if (product) {
        link.append(node("h3", "creator-profile-catalog-card__title", product.title));
        if (product.subtitle && memberRoot.dataset.creatorProfileTier === "creator") {
          link.append(node("p", "creator-profile-catalog-card__subtitle", product.subtitle));
        }
        card.append(link);
      }
      else card.setAttribute("aria-label", `Empty catalog slot ${index + 1}`);
      slot.append(card);
      if (product) {
        const label = node("label", "creator-profile-catalog-card__shelved");
        const checkbox = node("input");
        checkbox.type = "checkbox";
        checkbox.dataset.profileShelved = "";
        checkbox.dataset.productId = product.id;
        checkbox.checked = product.shelved === true;
        label.append(checkbox, document.createTextNode(" Shelved"));
        slot.append(label);
      }
      if (product && !product.public) slot.append(node("p", "creator-profile-catalog-card__notice", "Not visible to visitors until published and available."));
      fragment.append(slot);
    }
    cards.replaceChildren(fragment);
  }

  async function loadCreatorShelf(creator) {
    const requestId = ++currentRequest;
    status.textContent = "Loading catalog…";
    const query = `?creator=${encodeURIComponent(creator.id)}`;
    const [publicShelf, privateShelf] = await Promise.all([
      fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(creator.slug)}`, { credentials: "omit", cache })
        .then(response => response.ok ? response.json() : { products: [] }).catch(() => ({ products: [] })),
      fetch(`/api/creator/profile-shelf${query}`, { credentials: "same-origin", cache, headers: { accept: "application/json" } })
        .then(async response => ({ response, payload: await response.json().catch(() => ({})) }))
    ]);
    if (requestId !== currentRequest) return;
    if (!privateShelf.response.ok) {
      catalog.hidden = true;
      status.textContent = privateShelf.payload?.error?.message || "This Creator Profile is not available for management by this account.";
      renderBooks(memberRoot, publicShelf.products || []);
      return;
    }
    loadedState = privateShelf.payload;
    if (publicCatalog) publicCatalog.hidden = true;
    catalog.hidden = false;
    renderMemberShelf(loadedState, publicShelf.creator);
    renderCreatorInfo(memberInfo, publicShelf.creator);
    renderCounters(loadedState);
    renderCatalogCards(loadedState);
    status.textContent = loadedState.products.length
      ? "Choose a checkbox to place or remove a title from the bookshelf."
      : "Your catalog is ready for its first title.";
  }

  async function initializeOwnerControls() {
    const accountResponse = await fetch("/api/account/me", { credentials: "same-origin", cache });
    const account = accountResponse.ok ? await accountResponse.json() : null;
    csrfToken = String(account?.csrfToken || "");
    const profileTier = memberRoot.dataset.creatorProfileTier;
    if (!account?.authenticated || !accountClasses.has(account.user?.accountClass) ||
      (profileTier !== "public" && account.user.accountClass !== profileTier)) return;

    const optionsResponse = await fetch("/api/creator/identity-options", { credentials: "same-origin", cache });
    const options = optionsResponse.ok ? await optionsResponse.json() : null;
    const identities = (options?.creators || []).filter(identity => identity.permission === "manager");
    if (!identities.length) return;
    const rememberedId = localStorage.getItem("trg_current_creator_identity");
    selectedCreator = profileTier === "public"
      ? identities.find(identity => identity.slug === memberRoot.dataset.publicCreatorShelf)
      : identities.find(identity => identity.id === rememberedId) || identities[0];
    if (!selectedCreator) return;
    await loadCreatorShelf(selectedCreator);
  }

  cards.addEventListener("change", async event => {
    const checkbox = event.target.closest("input[data-profile-shelved]");
    if (!checkbox || !selectedCreator || !loadedState || saving) return;
    const beforeIds = loadedState.productIds.slice();
    const requestedIds = selectedIds();
    const shelfCount = loadedState.shelf.used;
    const wasShelved = beforeIds.includes(checkbox.dataset.productId);
    if (!wasShelved && loadedState.shelf.limit !== null && shelfCount >= loadedState.shelf.limit) {
      checkbox.checked = false;
      status.textContent = `Shelf allowance reached (${shelfCount} / ${loadedState.shelf.limit}). Remove another title first.`;
      return;
    }
    saving = true;
    cards.querySelectorAll("input[data-profile-shelved]").forEach(control => { control.disabled = true; });
    status.textContent = "Saving shelf selection…";
    try {
      const response = await fetch(`/api/creator/profile-shelf?creator=${encodeURIComponent(selectedCreator.id)}`, {
        method: "POST", credentials: "same-origin", cache,
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ productIds: requestedIds })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "The shelf selection could not be saved.");
      loadedState = payload;
      renderCounters(loadedState);
      renderCatalogCards(loadedState);
      const publicResponse = await fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(selectedCreator.slug)}&refresh=${Date.now()}`, { credentials: "omit", cache });
      const publicState = publicResponse.ok ? await publicResponse.json() : { products: [] };
      renderMemberShelf(loadedState, publicState.creator);
      renderCreatorInfo(memberInfo, publicState.creator);
      status.textContent = "Shelf selection saved.";
    } catch (error) {
      loadedState.productIds = beforeIds;
      renderCatalogCards(loadedState);
      status.textContent = error.message || "The shelf selection could not be saved. Your previous selection was restored.";
    } finally {
      saving = false;
    }
  });

  initializeOwnerControls().catch(() => {
    catalog.hidden = true;
    if (!publicRoots.length) renderBooks(memberRoot, []);
    status.textContent = "Creator shelf controls are unavailable. Try refreshing the Profile.";
  });
})();
