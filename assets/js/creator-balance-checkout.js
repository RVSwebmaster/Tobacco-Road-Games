(() => {
  const root = document.querySelector("[data-creator-balance]");
  if (!root) return;
  const status = root.querySelector("[data-creator-balance-status]"),
    button = root.querySelector("[data-creator-balance-submit]"),
    feedback = root.querySelector("[data-creator-balance-feedback]"),
    externalFeedback = document.querySelector("[data-cart-checkout-feedback]");
  let csrf = "",
    email = "",
    currentTotalCents = 0,
    currentCheckoutReady = false,
    refreshNumber = 0;
  const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);

  async function refresh(detail = {}) {
    const requestNumber = ++refreshNumber, cart = globalThis.TRGCart?.readCart();
    if (!cart?.items?.length) { root.hidden = true; return; }
    currentTotalCents = Number.isInteger(detail.totalCents)
      ? detail.totalCents
      : cart.items.reduce((total, item) => total + Number(item.amountCents || 0), 0);
    if (typeof detail.checkoutReady === "boolean")
      currentCheckoutReady = detail.checkoutReady;
    try {
      const me = await fetch("/api/account/me", { credentials: "same-origin", cache: "no-store" }).then((response) => response.json());
      if (!me.authenticated) { root.hidden = true; return; }
      csrf = me.csrfToken || ""; email = me.user?.email || "";
      const params = new URLSearchParams();
      for (const item of cart.items) params.append("product", item.slug);
      const response = await fetch(`/api/creator-balance?${params}`, { credentials: "same-origin", cache: "no-store" });
      if (requestNumber !== refreshNumber) return;
      if (!response.ok) { root.hidden = true; return; }
      const data = await response.json(), capability = data.internalPurchase || {};
      if (
        !currentCheckoutReady ||
        !capability.canUseBalance ||
        !capability.allProductsEligible
      ) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      const sufficient = currentTotalCents > 0 && data.balance.availableCents >= currentTotalCents;
      button.disabled = !sufficient;
      button.textContent = sufficient ? `Use ${money(currentTotalCents)} from Creator Balance` : "Creator Balance cannot cover this cart";
      status.textContent = sufficient
        ? `Creator Balance: ${money(data.balance.availableCents)}. This pays the full ${money(currentTotalCents)} with no external card charge.`
        : `Creator Balance: ${money(data.balance.availableCents)}. The full ${money(currentTotalCents)} is required, so use external checkout. Split tender is not available; Balance and card payment cannot be combined.`;
    } catch { root.hidden = true; }
  }

  document.addEventListener("trg:cart-rendered", (event) => void refresh(event.detail || {}));
  button.addEventListener("click", async () => {
    feedback.textContent = ""; button.disabled = true;
    try {
      const cart = globalThis.TRGCart?.readCart();
      if (!cart?.items?.length) throw new Error("Add an item before checkout.");
      const entered = document.querySelector("[data-cart-email]")?.value.trim() || email,
        confirmation = document.querySelector("[data-cart-email-confirmation]")?.value.trim() || entered,
        response = await fetch("/api/creator-balance", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ items: cart.items.map(({ slug, quantity, amountCents }) => ({ slug, quantity, amountCents })), email: entered, emailConfirmation: confirmation, checkoutAttemptId: `trgca_${crypto.randomUUID()}`, paymentSource: "creator_balance" }),
        }),
        data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.error || "Creator Balance purchase failed.");
      globalThis.TRGCart.clearCart();
      feedback.textContent = `Purchase complete. Order ${data.publicOrderReference}. Opening My Library…`;
      location.assign(data.accessUrl || "/account.html");
    } catch (error) {
      const message = error.message;
      await refresh({
        checkoutReady: currentCheckoutReady,
        totalCents: currentTotalCents,
      });
      feedback.textContent = message;
      if (externalFeedback) externalFeedback.textContent = `${message} Review the refreshed payment options below.`;
    }
  });
  void refresh();
})();
