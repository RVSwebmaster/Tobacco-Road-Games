(() => {
  const endpoint = "/api/store/status";
  const state = { available: false, state: "CLOSED" };

  function purchaseControls(documentRef = globalThis.document) {
    return documentRef?.querySelectorAll?.("[data-cart-add], [data-store-purchase], [data-cart-checkout-submit]") || [];
  }

  function applyStoreState(result, documentRef = globalThis.document) {
    state.available = result?.available === true;
    state.state = state.available && ["OPEN", "CLOSED", "MAINTENANCE"].includes(result?.state)
      ? result.state
      : "CLOSED";
    const open = state.state === "OPEN" && state.available;
    for (const control of purchaseControls(documentRef)) {
      if (open) continue;
      if (control.tagName === "A") {
        control.dataset.storeOriginalHref = control.getAttribute("href") || "";
        control.removeAttribute("href");
        control.setAttribute("role", "button");
      }
      control.disabled = true;
      control.setAttribute("aria-disabled", "true");
      control.hidden = true;
    }
    if (!open && documentRef?.body && !documentRef.querySelector?.("[data-store-closed-notice]")) {
      const notice = documentRef.createElement("section");
      notice.className = "store-section store-callout";
      notice.dataset.storeClosedNotice = "true";
      notice.setAttribute("role", "status");
      notice.innerHTML = `<div class="store-callout__copy"><p class="section-heading__kicker">Store Closed</p><h2>Purchasing is temporarily unavailable.</h2><p>We are working on products and store details. You may keep browsing, but new purchases and checkout are disabled.</p></div>`;
      const main = documentRef.querySelector("main");
      main?.insertBefore(notice, main.firstChild);
    }
    documentRef?.dispatchEvent?.(new CustomEvent("trg:store-state", { detail: { ...state } }));
    return { ...state };
  }

  async function refresh(fetchImpl = globalThis.fetch, documentRef = globalThis.document) {
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("status unavailable");
      return applyStoreState(await response.json(), documentRef);
    } catch {
      return applyStoreState({ available: false, state: "CLOSED" }, documentRef);
    }
  }

  globalThis.TRGStoreStatus = { applyStoreState, refresh, state };
  if (globalThis.document) {
    document.addEventListener("click", (event) => {
      if (state.state === "OPEN" && state.available) return;
      if (event.target?.closest?.("[data-cart-add], [data-store-purchase], [data-cart-checkout-submit]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    void refresh();
  }
})();
