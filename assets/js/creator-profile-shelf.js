(() => {
  const publicRoots = Array.from(document.querySelectorAll("[data-public-creator-shelf]"));
  const memberRoot = document.querySelector("[data-member-creator-shelf]");
  const catalog = document.querySelector("[data-creator-profile-catalog]");
  if (!publicRoots.length && !memberRoot) return;

  const cache = "no-store";
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
    const shelf = root.querySelector("[data-creator-profile-shelf-books]");
    if (!shelf) return;
    shelf.replaceChildren(...products.map(createBook));
    root.hidden = false;
  }

  async function loadPublicShelf(root, creatorSlug) {
    try {
      const response = await fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(creatorSlug)}`, {
        credentials: "omit", cache
      });
      const payload = response.ok ? await response.json() : null;
      renderBooks(root, payload?.products || []);
    } catch {
      renderBooks(root, []);
    }
  }

  publicRoots.forEach(root => loadPublicShelf(root, root.dataset.publicCreatorShelf));
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
    return Array.from(cards.querySelectorAll("input[data-profile-shelved]:checked"), input => input.dataset.productId);
  }

  function renderCatalogCards(state) {
    const fragment = document.createDocumentFragment();
    const products = state.products || [];
    const capacity = state.catalog.limit === null
      ? products.length
      : Math.max(state.catalog.limit, products.length);
    for (let index = 0; index < capacity; index += 1) {
      const product = products[index];
      if (!product) {
        fragment.append(node("div", "creator-profile-catalog-slot--empty"));
        continue;
      }
      const slot = node("div", "creator-profile-catalog-slot");
      const card = node("article", "product-card creator-profile-catalog-card");
      if (product.coverImage) {
        const media = node("div", "product-card__media");
        const image = node("img", "creator-profile-catalog-card__cover");
        image.src = product.coverImage;
        image.alt = `${product.title} cover`;
        image.loading = "lazy";
        image.decoding = "async";
        media.append(image);
        card.append(media);
      } else {
        card.append(node("div", "creator-profile-catalog-card__cover"));
      }
      card.append(node("h3", "creator-profile-catalog-card__title", product.title));
      const label = node("label", "creator-profile-catalog-card__shelve");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.checked = product.shelved === true;
      checkbox.dataset.profileShelved = "";
      checkbox.dataset.productId = product.id;
      checkbox.setAttribute("aria-label", `Place ${product.title} on the Profile bookshelf`);
      label.append(checkbox, document.createTextNode("Shelf"));
      slot.append(card, label);
      if (!product.public) {
        slot.append(node("p", "creator-profile-catalog-card__notice", "Not visible to visitors until published and available."));
      }
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
    catalog.hidden = false;
    renderBooks(memberRoot, publicShelf.products || []);
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
    if (!account?.authenticated || !accountClasses.has(account.user?.accountClass) || account.user.accountClass !== profileTier) return;

    const optionsResponse = await fetch("/api/creator/identity-options", { credentials: "same-origin", cache });
    const options = optionsResponse.ok ? await optionsResponse.json() : null;
    const identities = (options?.creators || []).filter(identity => identity.permission === "manager");
    if (!identities.length) return;
    const rememberedId = localStorage.getItem("trg_current_creator_identity");
    selectedCreator = identities.find(identity => identity.id === rememberedId) || identities[0];
    await loadCreatorShelf(selectedCreator);
  }

  cards.addEventListener("change", async event => {
    const checkbox = event.target.closest("input[data-profile-shelved]");
    if (!checkbox || !selectedCreator || !loadedState || saving) return;
    const beforeIds = loadedState.productIds.slice();
    const requestedIds = selectedIds();
    const shelfCount = loadedState.shelf.used;
    if (checkbox.checked && loadedState.shelf.limit !== null && shelfCount >= loadedState.shelf.limit) {
      checkbox.checked = false;
      status.textContent = `Shelf allowance reached (${shelfCount} / ${loadedState.shelf.limit}). Remove another title first.`;
      return;
    }
    saving = true;
    cards.querySelectorAll("input[data-profile-shelved]").forEach(input => { input.disabled = true; });
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
      const publicResponse = await fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(selectedCreator.slug)}`, { credentials: "omit", cache });
      const publicState = publicResponse.ok ? await publicResponse.json() : { products: [] };
      renderBooks(memberRoot, publicState.products || []);
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
    renderBooks(memberRoot, []);
    status.textContent = "Creator shelf controls are unavailable. Try refreshing the Profile.";
  });
})();
