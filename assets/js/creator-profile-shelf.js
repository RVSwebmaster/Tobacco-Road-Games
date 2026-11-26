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

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createBook(product) {
    const link = node("a", "bookshelf-book creator-profile-shelf-book");
    link.href = product.detailUrl;
    link.setAttribute("aria-label", `Open ${product.title} product page`);
    link.dataset.spineWidth = "68";
    link.dataset.spineSource = "catalog-cover";
    link.style.setProperty("--book-spine-width", "68px");
    link.style.setProperty("--book-height", "268px");
    const scene = node("span", "bookshelf-book__scene");
    const spine = node("span", "bookshelf-book__spine");
    spine.append(node("span", "bookshelf-book__status", product.creatorName || "CREATOR"));
    spine.append(node("span", "bookshelf-book__title", product.title));
    spine.append(node("span", "bookshelf-book__author", product.creatorName || ""));
    const frame = node("span", "bookshelf-book__cover-frame");
    if (product.coverUrl) {
      const image = node("img", "bookshelf-book__cover");
      image.src = product.coverUrl;
      image.alt = `${product.title} cover`;
      image.loading = "lazy";
      image.decoding = "async";
      frame.append(image);
    }
    scene.append(spine, frame);
    link.append(scene);
    return link;
  }

  function renderBooks(root, products) {
    const shelf = root.querySelector("[data-creator-profile-shelf-books]");
    if (!shelf) return;
    const fragment = document.createDocumentFragment();
    products.forEach(product => fragment.append(createBook(product)));
    shelf.replaceChildren(fragment);
    root.hidden = products.length === 0;
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

  const identitySelect = catalog.querySelector("[data-creator-shelf-identity]");
  const identityWrap = catalog.querySelector("[data-creator-shelf-identity-wrap]");
  const cards = catalog.querySelector("[data-creator-profile-catalog-cards]");
  const counters = catalog.querySelector("[data-creator-shelf-counters]");
  const status = catalog.querySelector("[data-creator-shelf-status]");
  let selectedCreator = null;
  let loadedState = null;

  function allowance(label, allowanceState) {
    const max = allowanceState.limit === null ? "Unlimited" : allowanceState.limit;
    return `${label}: ${allowanceState.used} / ${max}`;
  }

  function renderCounters(state) {
    counters.replaceChildren(
      node("p", "creator-profile-shelf-counter", allowance("Catalog allowance", state.catalog)),
      node("p", "creator-profile-shelf-counter", allowance("Shelf allowance", state.shelf))
    );
  }

  function selectedIds() {
    return Array.from(cards.querySelectorAll("input[data-profile-shelved]:checked"), input => input.dataset.productId);
  }

  function renderCatalogCards(state) {
    const fragment = document.createDocumentFragment();
    for (const product of state.products || []) {
      const card = node("article", "creator-profile-catalog-card");
      const image = product.coverImage ? node("img", "creator-profile-catalog-card__cover") : null;
      if (image) {
        image.src = product.coverImage;
        image.alt = `${product.title} cover`;
        image.loading = "lazy";
        image.decoding = "async";
      }
      const title = node("h3", "creator-profile-catalog-card__title", product.title);
      const meta = node("p", "creator-profile-catalog-card__meta", `${product.publicationState} · ${product.status || "status unavailable"}`);
      const label = node("label", "creator-profile-catalog-card__shelve");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.checked = product.shelved === true;
      checkbox.dataset.profileShelved = "";
      checkbox.dataset.productId = product.id;
      checkbox.setAttribute("aria-label", `Shelved: ${product.title}`);
      label.append(checkbox, document.createTextNode(" Shelved"));
      card.append(...(image ? [image] : []), title, meta, label);
      if (!product.public && product.shelved) {
        card.append(node("p", "creator-profile-catalog-card__notice", "Not currently available to visitors; its shelf assignment is retained."));
      } else if (!product.public) {
        card.append(node("p", "creator-profile-catalog-card__notice", "This title is not currently visible to visitors. Its shelf assignment can be prepared here."));
      }
      fragment.append(card);
    }
    cards.replaceChildren(fragment);
  }

  async function loadCreatorShelf(creator) {
    const requestId = ++currentRequest;
    status.textContent = "Loading Creator catalog…";
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
    status.textContent = loadedState.products.length ? "Choose Shelved titles to update the public bookshelf." : "No products are associated with this Creator yet.";
  }

  async function initializeOwnerControls() {
    const accountResponse = await fetch("/api/account/me", { credentials: "same-origin", cache });
    const account = accountResponse.ok ? await accountResponse.json() : null;
    csrfToken = String(account?.csrfToken || "");
    const profileTier = memberRoot.dataset.creatorProfileTier;
    if (!account?.authenticated || !accountClasses.has(account.user?.accountClass) || account.user.accountClass !== profileTier) {
      const slug = new URL(location.href).searchParams.get("creator") || "";
      if (slug) {
        const identity = await fetch(`/api/public/creator-shelf?creatorSlug=${encodeURIComponent(slug)}`, { credentials: "omit", cache })
          .then(async response => response.ok ? response.json() : null).catch(() => null);
        renderBooks(memberRoot, identity?.products || []);
      }
      return;
    }
    const optionsResponse = await fetch("/api/creator/identity-options", { credentials: "same-origin", cache });
    const options = optionsResponse.ok ? await optionsResponse.json() : null;
    const identities = (options?.creators || []).filter(identity => identity.permission === "manager");
    if (!identities.length) return;
    identityWrap.hidden = identities.length < 2;
    identitySelect.replaceChildren(...identities.map(identity => {
      const option = new Option(identity.displayName, identity.id);
      option.dataset.slug = identity.slug;
      return option;
    }));
    let chosen = identities.find(identity => identity.id === localStorage.getItem("trg_current_creator_identity"));
    if (!chosen) chosen = identities.length === 1 ? identities[0] : null;
    if (!chosen) {
      identityWrap.hidden = false;
      identitySelect.add(new Option("Choose a Creator identity", ""), 0);
      identitySelect.value = "";
      status.textContent = "Choose the Creator identity whose shelf you want to manage.";
      memberRoot.hidden = true;
      catalog.hidden = false;
      identitySelect.onchange = () => {
        selectedCreator = identities.find(identity => identity.id === identitySelect.value) || null;
        if (selectedCreator) loadCreatorShelf(selectedCreator);
      };
      return;
    }
    selectedCreator = chosen;
    identitySelect.value = chosen.id;
    identitySelect.onchange = () => {
      selectedCreator = identities.find(identity => identity.id === identitySelect.value) || null;
      if (selectedCreator) loadCreatorShelf(selectedCreator);
    };
    await loadCreatorShelf(selectedCreator);
  }

  cards.addEventListener("change", async event => {
    const checkbox = event.target.closest("input[data-profile-shelved]");
    if (!checkbox || !selectedCreator || !loadedState || saving) return;
    const beforeIds = loadedState.productIds.slice();
    const requestedIds = selectedIds();
    const publicCount = loadedState.shelf.used;
    if (checkbox.checked && loadedState.shelf.limit !== null && publicCount >= loadedState.shelf.limit) {
      checkbox.checked = false;
      status.textContent = `Shelf allowance reached (${publicCount} / ${loadedState.shelf.limit}). Unshelve a product first.`;
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
