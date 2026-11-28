(() => {
  const root = document.querySelector("[data-customer-membership]");
  if (!root) return;
  const status = root.querySelector("[data-membership-status]");
  let csrfToken = "";
  const setText = (selector, value, fallback = "Unavailable") => {
    const node = root.querySelector(selector);
    if (node) node.textContent = value || fallback;
  };
  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date)
      : "Unavailable";
  };

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin", cache: "no-store", ...options,
      headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json", "x-csrf-token": csrfToken } : {}), ...options.headers },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || "This Dashboard action is unavailable.");
    return result;
  }

  async function loadDashboard() {
    const [me, profile, library] = await Promise.all([
      requestJson("/api/account/me"), requestJson("/api/account/profile"), requestJson("/api/account/library"),
    ]);
    if (!me?.authenticated || !me.user) { location.replace("/account.html"); return; }
    csrfToken = me.csrfToken || "";
    const member = me.user;
    const privateUser = profile?.user || {};
    setText("[data-membership-display-name]", member.displayName);
    setText("[data-membership-real-name]", privateUser.legalName);
    setText("[data-membership-email]", member.email);
    setText("[data-membership-status-value]", member.status);
    setText("[data-membership-joined]", formatDate(member.createdAt));
    setText("[data-membership-notices]", typeof privateUser.notificationPreferences?.accountNotices === "boolean"
      ? (privateUser.notificationPreferences.accountNotices ? "On" : "Off") : "Not set");
    window.TRGAccountProfileEditor?.fill(root.querySelector("[data-membership-profile-form]"), privateUser);
    showAvatar(privateUser.avatarUrl, member.displayName);
    renderLibrary(Array.isArray(library?.items) ? library.items : []);
    attachProfileEditor();
    attachProfileOpeners();
    attachPortalControls();
    await loadPaymentMethods(new URLSearchParams(location.search).has("payment_methods"));
    if (status) status.textContent = "Your Customer membership information is up to date.";
  }

  async function loadPaymentMethods(returned = false) {
    const message = root.querySelector("[data-payment-methods-status]");
    const list = root.querySelector("[data-membership-payment-methods]");
    const address = root.querySelector("[data-membership-billing-address]");
    try {
      const result = await requestJson("/api/account/payment-methods");
      if (!list) return;
      const rows = (result.methods || []).map((method) => {
        const li = document.createElement("li");
        const expiry = method.expMonth && method.expYear ? ` · Expires ${String(method.expMonth).padStart(2, "0")}/${method.expYear}` : "";
        li.textContent = `${method.brand || "Card"} ending in ${method.last4 || "••••"}${expiry}${method.isDefault ? " · Default" : ""}`;
        return li;
      });
      list.replaceChildren(...rows);
      if (message) message.textContent = rows.length ? "Saved payment methods" : "No saved payment methods. You can purchase without saving one.";
      if (address) {
        const parts = Object.values(result.billingAddress || {}).filter(Boolean);
        address.textContent = parts.length ? `Billing address: ${parts.join(", ")}` : "No billing address is saved with Stripe.";
      }
      if (returned) setFeedback("Payment settings were updated with Stripe.");
    } catch (error) {
      if (message) message.textContent = "Payment management is unavailable right now.";
      if (address) address.textContent = "Billing address status is temporarily unavailable.";
      for (const button of root.querySelectorAll("[data-payment-method-portal]")) button.disabled = true;
      if (returned) setFeedback(error.message);
    }
  }

  function attachProfileEditor() {
    window.TRGAccountProfileEditor?.attach({
      form: root.querySelector("[data-membership-profile-form]"),
      status: root.querySelector("[data-profile-save-status]"),
      save: (values) => requestJson("/api/account/profile", { method: "POST", body: JSON.stringify(values) }),
    });
  }

  function attachProfileOpeners() {
    for (const button of root.querySelectorAll("[data-open-account-profile]")) {
      button.addEventListener("click", () => {
        const details = root.querySelector("[data-account-profile-settings]");
        if (!details) return;
        details.open = true;
        details.scrollIntoView({ behavior: "smooth", block: "center" });
        details.querySelector("input")?.focus({ preventScroll: true });
      });
    }
  }

  function attachPortalControls() {
    for (const button of root.querySelectorAll("[data-payment-method-portal]")) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        setFeedback("Opening Stripe's secure payment settings…");
        try {
          const result = await requestJson("/api/account/payment-methods/portal", {
            method: "POST", body: JSON.stringify({ purpose: button.dataset.paymentMethodPortal }),
          });
          location.assign(result.url);
        } catch (error) {
          setFeedback(error.message);
          button.disabled = false;
        }
      });
    }
  }

  function setFeedback(message) {
    const node = root.querySelector("[data-payment-methods-feedback]");
    if (node) node.textContent = message;
  }

  function showAvatar(url, displayName) {
    const image = root.querySelector("[data-membership-avatar]");
    const placeholder = root.querySelector("[data-membership-avatar-empty]");
    if (!image || !placeholder) return;
    if (!url) { image.hidden = true; placeholder.hidden = false; return; }
    image.alt = `${displayName || "Member"} profile image`;
    image.onload = () => { image.hidden = false; placeholder.hidden = true; };
    image.onerror = () => { image.hidden = true; placeholder.hidden = false; };
    image.src = url;
  }

  function renderLibrary(items) {
    const libraryStatus = root.querySelector("[data-membership-library-status]");
    const libraryList = root.querySelector("[data-membership-library]");
    if (!libraryList || !libraryStatus) return;
    if (!items.length) { libraryStatus.textContent = "No purchased products are in your library yet."; libraryList.replaceChildren(); return; }
    const rows = items.map((item) => {
      const row = document.createElement("li");
      row.append(document.createTextNode(String(item.productTitle || "Purchased product")));
      if (item.downloadUrl && item.downloadAvailable) {
        const link = document.createElement("a"); link.href = item.downloadUrl; link.textContent = "Download"; row.append(" · ", link);
      }
      if (item.currentLastUpdated && item.purchasedLastUpdated && item.currentLastUpdated !== item.purchasedLastUpdated) row.append(" · Product updated");
      return row;
    });
    libraryStatus.textContent = `${items.length} purchased ${items.length === 1 ? "product" : "products"} in your library.`;
    libraryList.replaceChildren(...rows.slice(0, 5));
  }

  root.querySelector("[data-membership-signout]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
      location.replace("/account.html");
    } catch { button.disabled = false; if (status) status.textContent = "Sign out could not be completed. Please try again."; }
  });

  loadDashboard().catch(() => {
    if (status) status.textContent = "Membership information could not be loaded. Please sign in again.";
    for (const selector of ["[data-membership-display-name]", "[data-membership-real-name]", "[data-membership-email]", "[data-membership-status-value]", "[data-membership-joined]", "[data-membership-notices]"]) setText(selector, "Unavailable");
    setText("[data-membership-library-status]", "Your library is unavailable right now.");
  });
})();
