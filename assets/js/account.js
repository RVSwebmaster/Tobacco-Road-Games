(() => {
  const status = document.querySelector("#account-status");
  const summary = document.querySelector("#account-summary");
  const signout = document.querySelector("#signout-button");
  const accountAccessPanel = document.querySelector("#account-access-panel");
  const accountSessionPanel = document.querySelector("#account-session-panel");
  const accountViewPanels = {
    signin: document.querySelector("#account-signin-panel"),
    register: document.querySelector("#account-register-panel"),
    forgot: document.querySelector("#account-forgot-panel"),
  };
  const resetPanel = document.querySelector("#reset-panel");
  const resetForm = document.querySelector("#reset-form");
  const libraryPanel = document.querySelector("#library-panel");
  const libraryStatus = document.querySelector("#library-status");
  const libraryList = document.querySelector("#library-list");
  const recoveryForm = document.querySelector("#purchase-recovery-form");
  const recoveryStatus = document.querySelector("#purchase-recovery-status");
  const accountProfilePanel = document.querySelector("#account-profile-panel"),
    accountProfileForm = document.querySelector("#account-profile-form"),
    accountProfileStatus = document.querySelector("#account-profile-status"),
    creatorRegistrationPanel = document.querySelector(
      "#creator-registration-panel",
    ),
    creatorRegistrationForm = document.querySelector(
      "#creator-registration-form",
    ),
    creatorRegistrationStatus = document.querySelector(
      "#creator-registration-status",
    ),
    creatorRegistrationDetails = document.querySelector(
      "#creator-registration-details",
    ),
    creatorOnboardingStatus = document.querySelector(
      "#creator-onboarding-status",
    ),
    creatorOnboardingMessage = document.querySelector(
      "#creator-onboarding-message",
    ),
    creatorStatusList = document.querySelector("#creator-status-list"),
    creatorAgreementVersion = document.querySelector(
      "#creator-agreement-version",
    ),
    creatorAgreementAccept = document.querySelector(
      "#creator-agreement-accept",
    ),
    creatorDashboardLink = document.querySelector("#creator-dashboard-link"),
    creatorPaymentGuidance = document.querySelector(
      "#creator-payment-guidance",
    ),
    creatorIdentityManagement = document.querySelector(
      "#creator-identity-management",
    ),
    creatorIdentityList = document.querySelector("#creator-identity-list");
  let csrfToken = "";
  let pendingClaimCredential = "";

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("discussion-status--error", error);
  };

  function showAccountView(view) {
    if (!Object.hasOwn(accountViewPanels, view)) return;
    for (const [name, panel] of Object.entries(accountViewPanels)) {
      if (panel) panel.hidden = name !== view;
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("[data-account-view]");
    if (!link) return;
    event.preventDefault();
    showAccountView(link.dataset.accountView);
    setStatus("");
    const firstField = accountViewPanels[link.dataset.accountView]?.querySelector("input");
    firstField?.focus();
  });
  showAccountView("signin");

  async function api(path, body = {}, options = {}) {
    const headers = { "content-type": "application/json" };
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    const response = await fetch(path, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers,
      method: options.method || "POST",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload?.error?.message ||
          "The account request could not be completed.",
      );
    }
    return payload;
  }

  async function refreshAccount() {
    const response = await fetch("/api/account/me", {
      credentials: "same-origin",
    });
    const payload = await response.json();
    csrfToken = payload.csrfToken || "";
    if (!payload.authenticated) {
      if (accountAccessPanel) accountAccessPanel.hidden = false;
      if (accountSessionPanel) accountSessionPanel.hidden = true;
      summary.textContent = "No account is signed in.";
      signout.hidden = true;
      if (libraryPanel) libraryPanel.hidden = true;
      if (accountProfilePanel) accountProfilePanel.hidden = true;
      if (creatorRegistrationPanel) creatorRegistrationPanel.hidden = true;
      setStatus(
        pendingClaimCredential
          ? "Sign in or create an account with the same email used for the purchase."
          : "Sign in or create a Tobacco Road Games account.",
      );
      return;
    }
    if (accountAccessPanel) accountAccessPanel.hidden = true;
    if (accountSessionPanel) accountSessionPanel.hidden = false;
    summary.innerHTML = "";
    const email = document.createElement("p");
    email.textContent = `Signed in as ${payload.user.email}`;
    summary.append(email);
    signout.hidden = false;
    refreshLibrary().catch((error) => {
      if (libraryStatus) libraryStatus.textContent = error.message;
    });
    refreshRegistrationPanels().catch((error) => {
      if (accountProfileStatus)
        accountProfileStatus.textContent = error.message;
    });
    if (pendingClaimCredential) {
      presentPendingClaim();
    } else {
      setStatus("Account loaded.");
    }
  }

  async function refreshLibrary() {
    if (!libraryPanel || !libraryList || !libraryStatus) return;
    libraryPanel.hidden = false;
    libraryStatus.textContent = "Loading your library...";
    const response = await fetch("/api/account/library", {
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload?.error?.message || "My Library could not be loaded.",
      );
    libraryList.replaceChildren();
    if (!payload.items?.length) {
      libraryStatus.textContent =
        "Your library is empty. Digital purchases made while signed in will appear here.";
      return;
    }
    const ratingCreators = new Set();
    for (const item of payload.items) {
      const card = document.createElement("article");
      card.className = "product-card";
      if (item.coverImage) {
        const media = document.createElement("div");
        media.className = "product-card__media";
        const image = document.createElement("img");
        image.src = item.coverImage;
        image.alt = `${item.productTitle} cover`;
        image.loading = "lazy";
        image.addEventListener("error", () => {
          media.hidden = true;
        });
        media.append(image);
        card.append(media);
      }
      const body = document.createElement("div");
      body.className = "product-card__body";
      const title = document.createElement("h3");
      title.className = "product-card__title";
      title.textContent = item.productTitle;
      const creator = document.createElement("p");
      creator.className = "product-card__meta";
      creator.textContent = item.creator
        ? `By ${item.creator}`
        : "Creator information unavailable";
      const order = document.createElement("p");
      order.className = "product-card__meta";
      const purchaseAmount = Number.isInteger(item.purchaseAmountCents)
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: item.purchaseCurrency || "USD",
          }).format(item.purchaseAmountCents / 100)
        : "";
      order.textContent = [
        `Order ${item.orderReference}`,
        new Date(item.purchaseDate).toLocaleDateString(),
        purchaseAmount,
        item.paymentDescription || "Paid through secure checkout",
      ].filter(Boolean).join(" · ");
      body.append(title, creator, order);
      if (item.purchasedVersion) {
        const version = document.createElement("p");
        version.className = "product-card__meta";
        version.textContent = `Purchased version ${item.purchasedVersion}`;
        body.append(version);
      }
      if (item.downloadUrl) {
        const link = document.createElement("a");
        link.className = "button button--primary";
        link.href = item.downloadUrl;
        link.textContent = "Download";
        body.append(link);
      } else {
        const note = document.createElement("p");
        note.className = "product-card__meta";
        note.textContent = item.downloadAvailable
          ? "Download access is temporarily unavailable."
          : "No active download entitlement.";
        body.append(note);
      }
      if (
        item.creatorId &&
        !ratingCreators.has(item.creatorId) &&
        window.TRGCreatorReputation
      ) {
        ratingCreators.add(item.creatorId);
        const ratingRoot = document.createElement("div");
        ratingRoot.className = "library-creator-rating";
        body.append(ratingRoot);
        window.TRGCreatorReputation.customerControl(
          ratingRoot,
          item.creatorId,
          item.creator,
        ).catch(() => {});
      }
      card.append(body);
      libraryList.append(card);
    }
    libraryStatus.textContent = `${payload.items.length} owned digital product${payload.items.length === 1 ? "" : "s"}.`;
  }

  recoveryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    recoveryStatus.textContent = "Verifying purchase access...";
    recoveryStatus.classList.remove("discussion-status--error");
    try {
      const url = new URL(
        recoveryForm.elements.accessLink.value,
        window.location.origin,
      );
      const credential = url.searchParams.get("credential") || "";
      if (!credential)
        throw new Error(
          "Paste the complete order-access link from your delivery email.",
        );
      const payload = await api("/api/account/claim-order", { credential });
      recoveryStatus.textContent = payload.message;
      pendingClaimCredential = "";
      sessionStorage.removeItem("trg.pendingPurchaseClaim");
      recoveryForm.reset();
      await refreshLibrary();
    } catch (error) {
      recoveryStatus.textContent = error.message;
      recoveryStatus.classList.add("discussion-status--error");
    }
  });

  document
    .querySelector("#signin-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      try {
        const result = await api("/api/auth/login", data);
        form.reset();
        if (result.user?.customerPrivilegesActive === true) {
          window.location.assign("/customer");
          return;
        }
        await refreshAccount();
        setStatus("Signed in.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });

  document
    .querySelector("#register-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      try {
        await api("/api/auth/register", data);
        form.reset();
        await refreshAccount();
        setStatus("Account created. You can sign in now.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });

  document
    .querySelector("#forgot-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      try {
        const payload = await api("/api/auth/request-password-reset", data);
        form.reset();
        setStatus(
          payload.message ||
            "If that account exists, reset instructions will be sent.",
        );
      } catch {
        setStatus("If that account exists, reset instructions will be sent.");
      }
    });

  signout?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", {});
      csrfToken = "";
      await refreshAccount();
      setStatus("Signed out.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const payload = await api("/api/auth/reset-password", data);
      resetPanel.hidden = true;
      event.currentTarget.reset();
      setStatus(payload.message || "Password reset complete.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  async function handleUrlTokens() {
    const url = new URL(window.location.href);
    const verify = url.searchParams.get("verify");
    const reset = url.searchParams.get("reset");
    const claim = url.searchParams.get("claim");
    if (claim && claim.length <= 2048 && claim.startsWith("oa1.")) {
      pendingClaimCredential = claim;
      sessionStorage.setItem("trg.pendingPurchaseClaim", claim);
      url.searchParams.delete("claim");
      history.replaceState(null, "", url.toString());
      presentPendingClaim();
    } else {
      pendingClaimCredential = sessionStorage.getItem("trg.pendingPurchaseClaim") || "";
      if (pendingClaimCredential) presentPendingClaim();
    }
    if (verify) {
      try {
        const payload = await api("/api/auth/verify-email", { token: verify });
        url.searchParams.delete("verify");
        history.replaceState(null, "", url.toString());
        await refreshAccount();
        setStatus(payload.message || "Email verified.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }
    if (reset) {
      resetPanel.hidden = false;
      resetForm.elements.token.value = reset;
      setStatus("Enter a new password to finish the reset.");
    }
  }

  function presentPendingClaim() {
    if (!pendingClaimCredential || !recoveryForm) return;
    const recovery = document.querySelector("#purchase-recovery");
    if (recovery) recovery.open = true;
    recoveryForm.elements.accessLink.value = `${window.location.origin}/store/order-access?credential=${encodeURIComponent(pendingClaimCredential)}`;
    if (recoveryStatus) {
      recoveryStatus.textContent = "Confirm below to add this purchase to My Library.";
      recoveryStatus.classList.remove("discussion-status--error");
    }
    setStatus("Confirm the purchase claim in My Library below.");
  }

  async function refreshRegistrationPanels() {
    accountProfilePanel.hidden = false;
    const profile = await fetch("/api/account/profile", {
      credentials: "same-origin",
    }).then(async (r) => {
      const p = await r.json();
      if (!r.ok)
        throw Error(p.error?.message || "Account profile unavailable.");
      return p;
    });
    window.TRGAccountProfileEditor?.fill(accountProfileForm, profile.user);
    const registration = await fetch("/api/creator-registration", {
      credentials: "same-origin",
    }).then(async (r) => {
      const p = await r.json();
      if (!r.ok)
        throw Error(
          p.error?.message || "Creator registration status is unavailable.",
        );
      return p;
    });
    creatorRegistrationPanel.hidden = false;
    creatorAgreementVersion.textContent =
      registration.agreement?.version || "Current version";
    const primary = registration.ownedCreators?.find(
      (x) => (x.identityType || x.identity_type) === "primary",
    );
    creatorRegistrationDetails.hidden = Boolean(primary);
    creatorOnboardingStatus.hidden = !primary;
    if (!primary) {
      creatorRegistrationForm.elements.contactEmail.value = profile.user.email;
      creatorRegistrationForm.elements.legalName.value =
        profile.user.legalName || "";
      return;
    }
    renderCreatorIdentities(registration.ownedCreators || []);
    renderCreatorReadiness(primary, registration.paymentCollection);
  }
  function renderCreatorIdentities(creators) {
    creatorIdentityManagement.hidden = false;
    creatorIdentityList.replaceChildren(
      ...creators.map((creator) => {
        const card = document.createElement("article"),
          title = document.createElement("h4"),
          details = document.createElement("p"),
          billing = creator.identityBilling || {};
        card.className = "product-card__body";
        title.textContent = creator.displayName;
        const preferred = creator.preferred?.active
          ? `Preferred through ${new Date(creator.preferred.termEndsAt).toLocaleDateString()}`
          : "Standard tier";
        details.textContent = billing.included
          ? `Primary identity · Included · No additional identity fee · ${preferred}`
          : `${billing.status === "current" ? "Current" : "Billing required"} · ${billing.billingPlan === "annual_prepaid" ? "Annual prepaid" : billing.billingPlan === "monthly" ? "Monthly" : "No plan"}${billing.coverageEndsAt ? ` · paid through ${new Date(billing.coverageEndsAt).toLocaleDateString()}` : ""} · ${preferred} (billed separately)`;
        if (!billing.included && creator.internalPurchase?.canUseBalance)
          details.textContent += ` · Creator Balance: $${(Number(creator.creatorBalanceAvailableCents || 0) / 100).toFixed(2)}`;
        card.append(title, details);
        if (!billing.included) {
          const actions = document.createElement("div");
          actions.className = "creator-onboarding-actions";
          for (const [plan, label, cents] of [
            ["monthly", "$10 monthly", 1000],
            ["annual_prepaid", "$100 annual prepaid", 10000],
          ]) {
            const stripe = document.createElement("button"),
              balance = document.createElement("button");
            stripe.type = balance.type = "button";
            stripe.className = "button button--secondary";
            balance.className = "button button--secondary";
            stripe.textContent = `Pay ${label} with Stripe`;
            balance.textContent = `Pay ${label} with Creator Balance`;
            stripe.dataset.identityBilling = "stripe";
            balance.dataset.identityBilling = "creator_balance";
            stripe.dataset.creatorId = balance.dataset.creatorId = creator.id;
            stripe.dataset.plan = balance.dataset.plan = plan;
            actions.append(stripe);
            if (creator.internalPurchase?.canUseBalance) {
              balance.disabled = Number(creator.creatorBalanceAvailableCents) < cents;
              balance.title = balance.disabled
                ? `The full ${(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} must be available. Split tender is not offered.`
                : "No external card charge will be made.";
              actions.append(balance);
            }
          }
          card.append(actions);
        }
        return card;
      }),
    );
  }
  creatorIdentityList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-identity-billing]");
    if (!button) return;
    button.disabled = true;
    try {
      const internal = button.dataset.identityBilling === "creator_balance",
        payload = await api("/api/creator-registration", {
          action: internal
            ? "purchase_identity_coverage_with_creator_balance"
            : "purchase_identity_coverage",
          creatorId: button.dataset.creatorId,
          plan: button.dataset.plan,
          paymentSource: internal ? "creator_balance" : "stripe",
          idempotencyKey: `svc_${crypto.randomUUID()}`,
        });
      if (payload.checkoutUrl) window.location.assign(payload.checkoutUrl);
      else await refreshRegistrationPanels();
    } catch (error) {
      const message = error.message;
      await refreshRegistrationPanels();
      creatorRegistrationStatus.textContent = message;
      button.disabled = false;
    }
  });
  function renderCreatorReadiness(creator, paymentCollection) {
    const labels = {
      customerAccountComplete: "Customer Account",
      creatorPublicComplete: "Creator Identity",
      creatorDetailsComplete: "Business Information",
      agreementCurrent: "Creator Agreement",
      paymentMethodReady: "Payment Method",
      payoutReady: "Payout Setup",
      identityEntitled: "Creator Account",
      creatorAccountOperational: "Account Standing",
      auditOperational: "Operational Audit",
    };
    creatorStatusList.replaceChildren(
      ...Object.entries(labels).map(([key, label]) => {
        const item = document.createElement("li"),
          name = document.createElement("strong"),
          state = document.createElement("span"),
          complete = Boolean(creator.checks?.[key]);
        name.textContent = label;
        state.textContent = complete ? "Complete" : "Needs attention";
        item.className = complete
          ? "creator-status-item creator-status-item--complete"
          : "creator-status-item creator-status-item--attention";
        item.append(name, state);
        return item;
      }),
    );
    creatorOnboardingMessage.textContent = creator.currentlyEligible
      ? "Your Creator registration is complete. You can now add products to Tobacco Road Games."
      : creator.historicallyCompleted
        ? "Your prior registration remains on record, but current eligibility needs attention. Use the Creator dashboard and the items below to restore access."
      : "Complete the items marked “Needs attention.” Product and listing tools remain unavailable until every registration requirement is complete.";
    creatorDashboardLink.hidden = !creator.historicallyCompleted;
    creatorAgreementAccept.hidden = Boolean(creator.checks?.agreementCurrent);
    creatorAgreementAccept.dataset.creatorId = creator.id;
    creatorPaymentGuidance.textContent = creator.paymentMethodReady
      ? "Your Stripe-hosted payment method is ready."
      : paymentCollection?.staging
        ? "Stripe-hosted payment-method collection is intentionally unavailable in this staging build. Tobacco Road Games does not collect or store raw card numbers."
        : "Stripe-hosted payment-method setup is not available yet. Tobacco Road Games does not collect or store raw card numbers.";
  }
  window.TRGAccountProfileEditor?.attach({
    form: accountProfileForm,
    status: accountProfileStatus,
    save: (values) => api("/api/account/profile", values),
  });
  creatorRegistrationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = event.currentTarget,
      d = Object.fromEntries(new FormData(f));
    d.acceptAgreement = f.acceptAgreement.checked;
    d.confirmRights = f.confirmRights.checked;
    d.links = d.website ? [{ label: "Website", url: d.website }] : [];
    delete d.website;
    try {
      const result = await api("/api/creator-registration", d);
      creatorRegistrationStatus.textContent = `Creator identity ${result.slug} created. Complete payment-method and payout setup to unlock product intake.`;
      await refreshRegistrationPanels();
    } catch (error) {
      creatorRegistrationStatus.textContent = error.message;
    }
  });
  creatorAgreementAccept?.addEventListener("click", async () => {
    try {
      await api("/api/creator-registration", {
        action: "accept_current_agreement",
        creatorId: creatorAgreementAccept.dataset.creatorId,
      });
      creatorRegistrationStatus.textContent =
        "Current Creator Agreement accepted.";
      await refreshRegistrationPanels();
    } catch (error) {
      creatorRegistrationStatus.textContent = error.message;
    }
  });

  refreshAccount()
    .then(() => {
      return handleUrlTokens();
    })
    .catch(() => {
      setStatus("Account service is not available yet.", true);
    });
})();
