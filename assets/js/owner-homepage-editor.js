(() => {
  const ENDPOINT = "/owner/api/homepage";
  const SHELVES = Object.freeze([
    { key: "featuredCreator", title: "Featured Creator", help: "Choose one eligible Creator, then pin their products in shelf order." },
    { key: "newThisWeek", title: "New This Week", help: "Pin eligible recent releases. The first title becomes the hero book." },
    { key: "bestSellers", title: "Best Sellers", help: "Pin products currently eligible from authoritative paid-order rankings." },
    { key: "freePwyw", title: "Free & PWYW", help: "Pin eligible free and pay-what-you-want products." }
  ]);
  const elements = {
    revision: document.getElementById("homepage-revision"),
    save: document.getElementById("homepage-publish"),
    shelves: document.getElementById("homepage-shelves"),
    status: document.getElementById("homepage-status")
  };
  let csrfToken = "";
  let revision = 0;
  let configuration = null;
  let products = [];
  let creators = [];
  let eligibility = {};
  let savedSnapshot = "";
  let busy = false;

  initialize();

  async function initialize() {
    setButton("loading");
    try {
      const response = await fetch(ENDPOINT, { credentials: "same-origin", headers: { accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
      applyPayload(payload);
      render();
      savedSnapshot = snapshot();
      setButton("ready");
      document.documentElement.dataset.ownerHomepageRuntime = "ready";
    } catch (error) {
      setStatus(`Could not load homepage merchandising. ${error.message}`, "error");
      setButton("error");
      document.documentElement.dataset.ownerHomepageRuntime = "error";
    }
  }

  function applyPayload(payload) {
    csrfToken = String(payload.csrfToken || csrfToken || "");
    if (!csrfToken) throw new Error("Owner homepage security token was not returned.");
    revision = Number(payload.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Homepage revision is invalid.");
    configuration = clone(payload.configuration);
    products = Array.isArray(payload.products) ? payload.products.slice() : products;
    creators = Array.isArray(payload.creators) ? payload.creators.slice() : creators;
    eligibility = payload.eligibility && typeof payload.eligibility === "object" ? clone(payload.eligibility) : eligibility;
    elements.revision.textContent = String(revision);
  }

  function render() {
    elements.shelves.replaceChildren(...SHELVES.map(renderShelf));
  }

  function renderShelf(definition) {
    const shelf = configuration.shelves[definition.key];
    const panel = node("section", "homepage-editor__panel");
    panel.dataset.shelf = definition.key;
    const heading = node("div", "homepage-editor__panel-heading");
    const copy = node("div");
    const title = node("h2", "homepage-editor__shelf-title", definition.title);
    const help = node("p", "homepage-editor__help", definition.help);
    copy.append(title, help);
    const visibilityLabel = node("label", "homepage-editor__visibility");
    const visibility = document.createElement("input");
    visibility.type = "checkbox";
    visibility.checked = shelf.visible;
    visibility.dataset.shelfVisibility = definition.key;
    visibility.addEventListener("change", () => {
      shelf.visible = visibility.checked;
      markDirty();
    });
    visibilityLabel.append(visibility, document.createTextNode(" Visible"));
    const manualLabel = node("label", "homepage-editor__visibility");
    const manual = document.createElement("input");
    manual.type = "checkbox";
    manual.checked = shelf.managed;
    manual.dataset.shelfManaged = definition.key;
    manual.addEventListener("change", () => {
      shelf.managed = manual.checked;
      if (!shelf.managed) shelf.productIds = [];
      render();
      markDirty();
    });
    manualLabel.append(manual, document.createTextNode(" Manual order"));
    const controls = node("span", "homepage-editor__heading-controls");
    controls.append(manualLabel, visibilityLabel);
    heading.append(copy, controls);
    panel.append(heading);

    if (definition.key === "featuredCreator") panel.append(renderCreatorSelect(shelf));
    const list = node("div", "homepage-editor__list");
    list.dataset.shelfProducts = definition.key;
    const candidates = shelfCandidates(definition.key, shelf);
    if (!candidates.length) {
      list.append(node("p", "homepage-editor__empty", "No native D1 products currently satisfy this shelf’s eligibility rules."));
    } else {
      for (const product of candidates) list.append(renderProductChoice(definition.key, shelf, product));
    }
    panel.append(list);
    return panel;
  }

  function renderCreatorSelect(shelf) {
    const wrapper = node("div", "homepage-editor__field");
    const label = document.createElement("label");
    label.htmlFor = "homepage-featured-creator";
    label.textContent = "Featured Creator";
    const select = document.createElement("select");
    select.id = "homepage-featured-creator";
    select.className = "dock-input";
    select.append(new Option("Choose an eligible Creator", ""));
    for (const creator of creators.filter((entry) => entry.eligible)) {
      select.append(new Option(creator.displayName, creator.id));
    }
    select.value = shelf.creatorId || "";
    select.addEventListener("change", () => {
      shelf.creatorId = select.value || null;
      const allowed = new Set(products.filter((product) => product.creatorId === shelf.creatorId).map((product) => product.id));
      shelf.productIds = shelf.productIds.filter((id) => allowed.has(id));
      render();
      markDirty();
    });
    wrapper.append(label, select);
    return wrapper;
  }

  function shelfCandidates(key, shelf) {
    const eligibleIds = new Set(Array.isArray(eligibility[key]) ? eligibility[key] : []);
    const productById = new Map(products.map((product) => [product.id, product]));
    const selected = shelf.productIds.map((id) => productById.get(id)).filter(Boolean);
    const selectedIds = new Set(selected.map((product) => product.id));
    const available = products.filter((product) => eligibleIds.has(product.id)
      && (key !== "featuredCreator" || (shelf.creatorId && product.creatorId === shelf.creatorId))
      && !selectedIds.has(product.id));
    available.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return [...selected, ...available];
  }

  function renderProductChoice(key, shelf, product) {
    const selectedIndex = shelf.productIds.indexOf(product.id);
    const selected = selectedIndex >= 0;
    const eligibleIds = new Set(Array.isArray(eligibility[key]) ? eligibility[key] : []);
    const eligibleNow = eligibleIds.has(product.id)
      && (key !== "featuredCreator" || product.creatorId === shelf.creatorId);
    const row = node("div", "homepage-editor__choice");
    row.dataset.productId = product.id;
    const label = node("label", "homepage-editor__choice-label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected;
    checkbox.value = product.id;
    checkbox.addEventListener("change", () => {
      shelf.productIds = checkbox.checked
        ? [...shelf.productIds, product.id]
        : shelf.productIds.filter((id) => id !== product.id);
      shelf.managed = true;
      render();
      markDirty();
    });
    const detail = node("span", "homepage-editor__choice-copy");
    detail.append(node("strong", "", product.title));
    detail.append(node("small", "", `${product.creatorName} · ${product.source === "native-d1" ? "Native D1" : product.source}`));
    if (selected && !eligibleNow) detail.append(node("small", "homepage-editor__warning", "Currently unavailable — remove before saving."));
    label.append(checkbox, detail);
    row.append(label);
    if (selected) {
      const controls = node("span", "homepage-editor__order-controls");
      controls.append(moveButton("↑", "Move earlier", selectedIndex > 0, () => move(shelf, selectedIndex, -1)));
      controls.append(moveButton("↓", "Move later", selectedIndex < shelf.productIds.length - 1, () => move(shelf, selectedIndex, 1)));
      row.append(controls);
    }
    return row;
  }

  function moveButton(text, title, enabled, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button homepage-editor__order-button";
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = !enabled;
    button.addEventListener("click", action);
    return button;
  }

  function move(shelf, index, delta) {
    const next = index + delta;
    if (next < 0 || next >= shelf.productIds.length) return;
    [shelf.productIds[index], shelf.productIds[next]] = [shelf.productIds[next], shelf.productIds[index]];
    render();
    markDirty();
  }

  elements.save.addEventListener("click", async () => {
    if (busy || snapshot() === savedSnapshot) return;
    const invalid = findInvalidSelection();
    if (invalid) { setStatus(invalid, "error"); return; }
    busy = true;
    setButton("publishing");
    setStatus("Saving homepage merchandising directly to Cloudflare D1…", "working");
    try {
      const response = await fetch(ENDPOINT, {
        body: JSON.stringify({ expectedRevision: revision, shelves: configuration.shelves }),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        method: "POST"
      });
      const payload = await response.json();
      if (response.status === 409 && payload.code === "revision_conflict") {
        configuration = clone(payload.configuration);
        revision = Number(payload.revision);
        elements.revision.textContent = String(revision);
        render();
        savedSnapshot = snapshot();
        throw new Error(payload.error || "The homepage changed after this editor loaded.");
      }
      if (!response.ok) throw new Error(payload.error || "Homepage save failed.");
      configuration = clone(payload.configuration);
      revision = Number(payload.revision);
      elements.revision.textContent = String(revision);
      savedSnapshot = snapshot();
      setButton("success");
      elements.status.dataset.state = "success";
      elements.status.innerHTML = `<strong>Saved.</strong> ${escapeHtml(payload.message)} <a href="/" target="_blank" rel="noopener">View public homepage</a>`;
    } catch (error) {
      busy = false;
      setButton(snapshot() === savedSnapshot ? "ready" : "dirty");
      setStatus(error.message, "error");
    } finally { busy = false; }
  });

  function findInvalidSelection() {
    const featured = configuration.shelves.featuredCreator;
    if (featured.productIds.length && !featured.creatorId) return "Choose a Featured Creator before selecting their products.";
    for (const definition of SHELVES) {
      const shelf = configuration.shelves[definition.key];
      const eligibleIds = new Set(Array.isArray(eligibility[definition.key]) ? eligibility[definition.key] : []);
      if (shelf.productIds.some((id) => !eligibleIds.has(id))) return `${definition.title} contains a product that is no longer eligible.`;
      if (shelf.productIds.length > 43) return `${definition.title} exceeds its 43-product capacity.`;
    }
    return "";
  }

  function markDirty() {
    const dirty = snapshot() !== savedSnapshot;
    setButton(dirty ? "dirty" : "ready");
    setStatus(dirty ? "You have unsaved homepage changes." : "", dirty ? "working" : "");
  }
  function snapshot() { return JSON.stringify(configuration?.shelves || {}); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  function setButton(state) {
    elements.save.dataset.state = state;
    const labels = {
      loading: "Loading Current Configuration…",
      ready: "Homepage Configuration Is Current",
      dirty: "Save Homepage Changes",
      publishing: "Saving to Cloudflare D1…",
      success: "Homepage Changes Saved",
      error: "Homepage Configuration Unavailable"
    };
    elements.save.textContent = labels[state] || "Save Homepage Changes";
    elements.save.disabled = !["dirty"].includes(state) || busy;
  }
  function setStatus(message, state) {
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state; else delete elements.status.dataset.state;
  }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
})();
