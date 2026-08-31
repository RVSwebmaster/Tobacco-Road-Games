(() => {
  const root = document.querySelector("[data-creator-balance]");
  if (!root) return;
  const status = root.querySelector("[data-creator-balance-status]"),
    button = root.querySelector("[data-creator-balance-submit]"),
    feedback = root.querySelector("[data-creator-balance-feedback]");
  let csrf = "",
    email = "";
  const money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(n || 0) / 100);
  async function init() {
    try {
      const me = await fetch("/api/account/me", {
        credentials: "same-origin",
      }).then((r) => r.json());
      if (!me.authenticated) return;
      csrf = me.csrfToken || "";
      email = me.user?.email || "";
      const response = await fetch("/api/creator-balance", {
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const data = await response.json();
      root.hidden = false;
      status.textContent = `Available to spend: ${money(data.balance.availableCents)}. Pending, held, and reserved earnings cannot be spent. Split tender is not available.`;
      button.disabled = !data.balance.spendable;
    } catch {}
  }
  button.addEventListener("click", async () => {
    feedback.textContent = "";
    button.disabled = true;
    try {
      const cart = globalThis.TRGCart?.readCart();
      if (!cart?.items?.length) throw new Error("Add an item before checkout.");
      const entered =
          document.querySelector("[data-cart-email]")?.value.trim() || email,
        confirmation =
          document
            .querySelector("[data-cart-email-confirmation]")
            ?.value.trim() || entered;
      const response = await fetch("/api/creator-balance", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({
            items: cart.items.map(({ slug, quantity, amountCents }) => ({
              slug,
              quantity,
              amountCents,
            })),
            email: entered,
            emailConfirmation: confirmation,
          checkoutAttemptId: `trgca_${crypto.randomUUID()}`,
            paymentSource: "creator_balance",
          }),
        }),
        data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Creator Balance purchase failed.");
      globalThis.TRGCart.clearCart();
      feedback.textContent = `Purchase complete. Order ${data.publicOrderReference}. Opening My Library…`;
      location.assign(data.accessUrl || "/account.html");
    } catch (e) {
      feedback.textContent = e.message;
      button.disabled = false;
    }
  });
  void init();
})();
