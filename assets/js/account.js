(() => {
  const status = document.querySelector("#account-status");
  const summary = document.querySelector("#account-summary");
  const signout = document.querySelector("#signout-button");
  const resend = document.querySelector("#resend-verification-button");
  const resetPanel = document.querySelector("#reset-panel");
  const resetForm = document.querySelector("#reset-form");
  const forumPanel = document.querySelector("#forum-profile-panel");
  const forumForm = document.querySelector("#forum-profile-form");
  const forumHeading = document.querySelector("#forum-profile-heading");
  const forumHandle = document.querySelector("#forum-handle");
  const forumHandleStatus = document.querySelector("#forum-handle-status");
  const forumProfileStatus = document.querySelector("#forum-profile-status");
  const forumVerification = document.querySelector(
    "#forum-profile-verification",
  );
  const forumSubmit = document.querySelector("#forum-profile-submit");
  const avatarEditor = document.querySelector("#forum-avatar-editor");
  const avatarPreview = document.querySelector("#forum-avatar-preview");
  const avatarHandle = document.querySelector("#forum-avatar-handle");
  const avatarFile = document.querySelector("#forum-avatar-file");
  const avatarUpload = document.querySelector("#forum-avatar-upload");
  const avatarDelete = document.querySelector("#forum-avatar-delete");
  const avatarStatus = document.querySelector("#forum-avatar-status");
  const avatarPresets = document.querySelector("#forum-avatar-presets");
  const libraryPanel = document.querySelector("#library-panel");
  const libraryStatus = document.querySelector("#library-status");
  const libraryList = document.querySelector("#library-list");
  const recoveryForm = document.querySelector("#purchase-recovery-form");
  const recoveryStatus = document.querySelector("#purchase-recovery-status");
  const customerPaymentPanel = document.querySelector("#customer-payment-method-panel");
  const customerPaymentList = document.querySelector("#customer-payment-method-list");
  const customerPaymentForm = document.querySelector("#customer-payment-method-form");
  const customerPaymentStatus = document.querySelector("#customer-payment-method-status");
  const customerPaymentGuidance = document.querySelector("#customer-payment-method-guidance");
  const customerPaymentElementHost = document.querySelector("#customer-payment-element");
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
  let preparedAvatar = null;
  let previewObjectUrl = "";
  let csrfToken = "";
  let googleInitialized = false;
  let googleInitializeAttempts = 0;
  let currentAccountEmailVerified = false;
  let currentAccount = null;
  let pendingClaimCredential = "";
  let stripeInstance = null;
  let stripeElements = null;
  let paymentElement = null;
  let activeSetupAttemptId = "";
  let savedPaymentMethods = [];
  const maxGoogleInitializeAttempts = 20;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("discussion-status--error", error);
  };

  function defaultLandingForAccount(user) {
    if (!user || user.customerPrivilegesActive === false) return "";
    if (user.accountClass === "customer") return "/customer";
    return ({
      creator: "/creator/",
      founding25: "/founding-25-profile/",
      premiumCreator: "/premium-creator-profile/",
      admin: "/admin-profile/",
      owner: "/owner-profile/",
    })[user.accountClass] || "/customer";
  }

  function redirectToAccountLanding() {
    const route = defaultLandingForAccount(currentAccount);
    if (!route) return false;
    window.location.assign(route);
    return true;
  }

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
    if (payload.googleClientId) {
      window.TRG_GOOGLE_CLIENT_ID = payload.googleClientId;
    }
    csrfToken = payload.csrfToken || "";
    if (!payload.authenticated) {
      currentAccount = null;
      currentAccountEmailVerified = false;
      summary.textContent = "No account is signed in.";
      signout.hidden = true;
      resend.hidden = true;
      if (forumPanel) forumPanel.hidden = true;
      if (libraryPanel) libraryPanel.hidden = true;
      if (accountProfilePanel) accountProfilePanel.hidden = true;
      if (customerPaymentPanel) customerPaymentPanel.hidden = true;
      if (creatorRegistrationPanel) creatorRegistrationPanel.hidden = true;
      setStatus(
        pendingClaimCredential
          ? "Sign in or create an account with the same email used for the purchase. Verify the email before claiming."
          : "Choose Google, sign in, or create a Tobacco Road Games account.",
      );
      return false;
    }
    summary.innerHTML = "";
    currentAccount = payload.user;
    currentAccountEmailVerified = Boolean(payload.user.emailVerified);
    const customerPrivilegesActive = payload.user.customerPrivilegesActive !== false;
    const email = document.createElement("p");
    email.textContent = `Signed in as ${payload.user.email}`;
    const verified = document.createElement("p");
    verified.textContent = payload.user.emailVerified
      ? "Email verified."
      : "Email not verified yet.";
    summary.append(email, verified);
    if (!customerPrivilegesActive) {
      const pending = document.createElement("p");
      pending.textContent = "Customer access activates after email verification and successful card registration.";
      summary.append(pending);
    }
    signout.hidden = false;
    resend.hidden = payload.user.emailVerified;
    if (accountProfilePanel) accountProfilePanel.hidden = false;
    if (forumPanel) {
      forumPanel.hidden = false;
      refreshForumProfile(payload.user.emailVerified).catch((error) => {
        forumProfileStatus.textContent = error.message;
        forumProfileStatus.classList.add("discussion-status--error");
      });
    }
    if (libraryPanel) libraryPanel.hidden = !customerPrivilegesActive;
    if (customerPrivilegesActive) {
      refreshLibrary().catch((error) => {
        if (libraryStatus) libraryStatus.textContent = error.message;
      });
      refreshRegistrationPanels().catch((error) => {
        if (accountProfileStatus) accountProfileStatus.textContent = error.message;
      });
    } else if (creatorRegistrationPanel) {
      creatorRegistrationPanel.hidden = true;
    }
    if (!customerPrivilegesActive) {
      refreshCustomerProfile().catch((error) => {
        if (accountProfileStatus) accountProfileStatus.textContent = error.message;
      });
    }
    if (customerPaymentPanel) {
      customerPaymentPanel.hidden = false;
      refreshCustomerPaymentMethods().catch((error) => {
        if (customerPaymentStatus) customerPaymentStatus.textContent = error.message;
      });
    }
    if (pendingClaimCredential) {
      presentPendingClaim(payload.user.emailVerified);
    } else {
      setStatus("Account loaded.");
    }
    return customerPrivilegesActive;
  }

  async function refreshCustomerProfile() {
    const response = await fetch("/api/account/profile", { credentials: "same-origin" });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(profile.error?.message || "Account profile unavailable.");
    for (const key of ["legalName", "birthday", "displayName", "avatarUrl"])
      if (accountProfileForm.elements[key]) accountProfileForm.elements[key].value = profile.user[key] || "";
    for (const [key, value] of Object.entries(profile.user.billing || {}))
      if (accountProfileForm.elements[key]) accountProfileForm.elements[key].value = value || "";
    accountProfileForm.elements.acceptTerms.checked = Boolean(profile.user.agreements?.termsVersion);
    accountProfileForm.elements.acknowledgePrivacy.checked = Boolean(profile.user.agreements?.privacyVersion);
    accountProfileForm.elements.acceptTerms.required = profile.user.customerPrivilegesActive === false || !profile.user.agreements?.termsVersion;
    accountProfileForm.elements.acknowledgePrivacy.required = profile.user.customerPrivilegesActive === false || !profile.user.agreements?.privacyVersion;
    accountProfileForm.elements.accountNotices.checked = Boolean(profile.user.notificationPreferences?.accountNotices);
    customerPaymentGuidance.textContent = profile.user.customerPrivilegesActive === false
      ? `${profile.user.emailVerified ? "Email verified" : "Verify your email"} and a successful saved-card setup are both required to activate Customer access.`
      : "Your Customer profile and personal library are active. You can add, select, or remove saved cards below.";
    return profile.user;
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

  async function refreshForumProfile(emailVerified) {
    const response = await fetch("/api/forum/profile/me", {
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload?.error?.message || "Your forum profile could not be loaded.",
      );
    const profile = payload.profile;
    forumVerification.hidden = emailVerified || Boolean(profile);
    if (profile) {
      forumHeading.textContent = "Your Forum Profile";
      forumHandle.value = profile.handle;
      forumHandle.readOnly = true;
      forumHandle.required = false;
      forumHandleStatus.textContent = `Public profile: /forum/member/${profile.handle}`;
      forumForm.elements.displayName.value = profile.displayName || "";
      forumForm.elements.biography.value = profile.biography || "";
      forumSubmit.textContent = "Save Profile";
      forumSubmit.disabled = false;
      forumForm.dataset.mode = "edit";
      avatarEditor.hidden = false;
      avatarHandle.textContent = `@${profile.handle}`;
      avatarPreview.src =
        profile.avatarUrl || "/assets/logo.png?v=forum-avatar-default";
      avatarDelete.hidden = !profile.avatarUrl;
      avatarPresets
        ?.querySelectorAll('input[name="avatarPreset"]')
        .forEach((input) => {
          input.checked = input.value === profile.avatarPresetId;
        });
    } else {
      forumHeading.textContent = "Create Forum Profile";
      forumHandle.value = "";
      forumHandle.readOnly = false;
      forumHandle.required = true;
      forumHandleStatus.textContent = "";
      forumForm.elements.displayName.value = "";
      forumForm.elements.biography.value = "";
      forumSubmit.textContent = "Create Forum Profile";
      forumSubmit.disabled = !emailVerified;
      forumForm.dataset.mode = "create";
      avatarEditor.hidden = true;
    }
  }

  avatarFile?.addEventListener("change", async () => {
    preparedAvatar = null;
    avatarUpload.disabled = true;
    const file = avatarFile.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setAvatarStatus("Choose an image no larger than 1 MiB.", true);
      return;
    }
    try {
      preparedAvatar = await prepareAvatar(file);
      if (!preparedAvatar || preparedAvatar.size > 1024 * 1024) {
        preparedAvatar = null;
        throw new Error("prepared avatar too large");
      }
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(preparedAvatar);
      avatarPreview.src = previewObjectUrl;
      avatarUpload.disabled = false;
      setAvatarStatus("Preview ready. Upload to save this avatar.");
    } catch {
      setAvatarStatus(
        "That image could not be prepared. Choose a PNG, JPEG, or WebP image.",
        true,
      );
    }
  });

  avatarUpload?.addEventListener("click", async () => {
    if (!preparedAvatar) return;
    try {
      await avatarApi("POST", preparedAvatar);
      preparedAvatar = null;
      avatarFile.value = "";
      avatarUpload.disabled = true;
      await refreshForumProfile(true);
      setAvatarStatus("Forum avatar updated.");
    } catch (error) {
      setAvatarStatus(error.message, true);
    }
  });

  avatarPresets?.addEventListener("change", async (event) => {
    const input = event.target.closest('input[name="avatarPreset"]');
    if (!input) return;
    try {
      await avatarApi("POST", null, { presetId: input.value });
      preparedAvatar = null;
      avatarFile.value = "";
      avatarUpload.disabled = true;
      await refreshForumProfile(true);
      setAvatarStatus("Built-in forum avatar selected.");
    } catch (error) {
      await refreshForumProfile(true);
      setAvatarStatus(error.message, true);
    }
  });

  avatarDelete?.addEventListener("click", async () => {
    try {
      await avatarApi("DELETE");
      preparedAvatar = null;
      avatarFile.value = "";
      avatarUpload.disabled = true;
      await refreshForumProfile(true);
      setAvatarStatus("Default forum avatar restored.");
    } catch (error) {
      setAvatarStatus(error.message, true);
    }
  });

  async function avatarApi(method, blob, jsonBody) {
    const headers = {};
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    if (blob) headers["content-type"] = blob.type;
    if (jsonBody) headers["content-type"] = "application/json";
    const response = await fetch("/api/forum/profile/avatar", {
      body: jsonBody ? JSON.stringify(jsonBody) : blob || undefined,
      credentials: "same-origin",
      headers,
      method,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload?.error?.message || "The avatar request could not be completed.",
      );
    return payload;
  }

  async function prepareAvatar(file) {
    const image = await loadImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d", { alpha: true });
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const left = (image.naturalWidth - size) / 2;
    const top = (image.naturalHeight - size) / 2;
    context.drawImage(image, left, top, size, size, 0, 0, 256, 256);
    return (
      (await canvasBlob(canvas, "image/webp", 0.9)) ||
      (await canvasBlob(canvas, "image/png"))
    );
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("invalid image"));
      };
      image.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function setAvatarStatus(message, error = false) {
    avatarStatus.textContent = message;
    avatarStatus.classList.toggle("discussion-status--error", error);
  }

  let availabilityRequest = 0;
  forumHandle?.addEventListener("input", async () => {
    if (forumHandle.readOnly) return;
    const requestId = ++availabilityRequest;
    const handle = forumHandle.value;
    if (!handle) {
      forumHandleStatus.textContent = "";
      return;
    }
    const response = await fetch(
      `/api/forum/handle-availability?handle=${encodeURIComponent(handle)}`,
      { credentials: "same-origin" },
    );
    const payload = await response.json().catch(() => ({}));
    if (requestId !== availabilityRequest) return;
    forumHandleStatus.textContent = payload.available
      ? "That handle is available. Final availability is checked when you create the profile."
      : payload?.error?.message || "That handle is not available.";
    forumHandleStatus.classList.toggle(
      "discussion-status--error",
      !payload.available,
    );
  });

  forumForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const editing = event.currentTarget.dataset.mode === "edit";
    if (editing) delete data.handle;
    try {
      const payload = await api("/api/forum/profile", data, {
        method: editing ? "PATCH" : "POST",
      });
      forumProfileStatus.textContent = editing
        ? "Forum profile saved."
        : "Forum profile created.";
      forumProfileStatus.classList.remove("discussion-status--error");
      await refreshForumProfile(true);
      if (payload.profile)
        forumHandleStatus.textContent = `Public profile: /forum/member/${payload.profile.handle}`;
    } catch (error) {
      forumProfileStatus.textContent = error.message;
      forumProfileStatus.classList.add("discussion-status--error");
    }
  });

  document
    .querySelector("#signin-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      try {
        await api("/api/auth/login", data);
        form.reset();
        await refreshAccount();
        if (redirectToAccountLanding()) return;
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
      data.customerRegistration = true;
      data.acceptTerms = form.elements.acceptTerms.checked;
      data.acknowledgePrivacy = form.elements.acknowledgePrivacy.checked;
      try {
        await api("/api/auth/register", data);
        form.reset();
        await refreshAccount();
        setStatus("Account created. Verify your email, save a card, and Customer access will activate automatically.");
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

  resend?.addEventListener("click", async () => {
    try {
      const payload = await api("/api/auth/resend-verification", {});
      setStatus(payload.message || "Verification email sent.");
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
      presentPendingClaim(currentAccountEmailVerified);
    } else {
      pendingClaimCredential = sessionStorage.getItem("trg.pendingPurchaseClaim") || "";
      if (pendingClaimCredential) presentPendingClaim(currentAccountEmailVerified);
    }
    if (verify) {
      try {
        const payload = await api("/api/auth/verify-email", { token: verify });
        url.searchParams.delete("verify");
        history.replaceState(null, "", url.toString());
        const active = await refreshAccount();
        if (active) {
          window.location.assign("/customer");
          return;
        }
        setStatus(payload.message || "Email verified.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }
    if (url.searchParams.has("payment_setup_return")) {
      const setupIntentId = url.searchParams.get("setup_intent") || "";
      const attemptId = sessionStorage.getItem("trg.customerPaymentAttempt") || "";
      for (const key of ["payment_setup_return", "setup_intent", "setup_intent_client_secret", "redirect_status"])
        url.searchParams.delete(key);
      history.replaceState(null, "", url.toString());
      if (setupIntentId && attemptId) {
        try {
          await finishCustomerPaymentSetup(attemptId, setupIntentId);
        } catch (error) {
          customerPaymentStatus.textContent = error.message;
        }
      }
    }
    if (reset) {
      resetPanel.hidden = false;
      resetForm.elements.token.value = reset;
      setStatus("Enter a new password to finish the reset.");
    }
  }

  function presentPendingClaim(emailVerified) {
    if (!pendingClaimCredential || !recoveryForm) return;
    const recovery = document.querySelector("#purchase-recovery");
    if (recovery) recovery.open = true;
    recoveryForm.elements.accessLink.value = `${window.location.origin}/store/order-access?credential=${encodeURIComponent(pendingClaimCredential)}`;
    if (recoveryStatus) {
      recoveryStatus.textContent = emailVerified
        ? "This purchase is ready to claim. Confirm below to add it to My Library."
        : "Sign in with the purchase email and verify it before claiming.";
      recoveryStatus.classList.remove("discussion-status--error");
    }
    setStatus(
      emailVerified
        ? "Purchase access verified. Confirm the claim in My Library below."
        : "Sign in or create an account with the same email used for the purchase.",
    );
  }

  window.handleTrgGoogleCredential = async (credentialResponse) => {
    try {
      await api("/api/auth/google", {
        credential: credentialResponse.credential,
      });
      await refreshAccount();
      if (redirectToAccountLanding()) return;
      setStatus("Signed in with Google.");
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  function initializeGoogle() {
    if (googleInitialized) return true;
    const clientId =
      document.documentElement.dataset.googleClientId ||
      window.TRG_GOOGLE_CLIENT_ID ||
      "";
    const unavailable = document.querySelector("#google-unavailable");
    const control = document.querySelector("#google-signin-control");
    if (!clientId) {
      if (unavailable) unavailable.hidden = false;
      return false;
    }
    if (!window.google?.accounts?.id) {
      googleInitializeAttempts += 1;
      if (
        googleInitializeAttempts >= maxGoogleInitializeAttempts &&
        unavailable
      ) {
        unavailable.hidden = false;
      }
      return false;
    }
    if (unavailable) unavailable.hidden = true;
    if (control) control.innerHTML = "";
    window.google.accounts.id.initialize({
      callback: window.handleTrgGoogleCredential,
      client_id: clientId,
    });
    window.google.accounts.id.renderButton(control, {
      size: "large",
      text: "continue_with",
      theme: "outline",
      type: "standard",
    });
    googleInitialized = true;
    return true;
  }

  function scheduleGoogleInitialization() {
    if (initializeGoogle()) return;
    if (
      googleInitializeAttempts < maxGoogleInitializeAttempts &&
      (document.documentElement.dataset.googleClientId ||
        window.TRG_GOOGLE_CLIENT_ID ||
        "")
    ) {
      window.setTimeout(scheduleGoogleInitialization, 250);
    }
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
    for (const key of ["legalName", "birthday", "displayName", "avatarUrl"])
      if (accountProfileForm.elements[key])
        accountProfileForm.elements[key].value = profile.user[key] || "";
    for (const [key, value] of Object.entries(profile.user.billing || {}))
      if (accountProfileForm.elements[key]) accountProfileForm.elements[key].value = value || "";
    accountProfileForm.elements.acceptTerms.checked = Boolean(profile.user.agreements?.termsVersion);
    accountProfileForm.elements.acknowledgePrivacy.checked = Boolean(profile.user.agreements?.privacyVersion);
    accountProfileForm.elements.acceptTerms.required = profile.user.customerPrivilegesActive === false || !profile.user.agreements?.termsVersion;
    accountProfileForm.elements.acknowledgePrivacy.required = profile.user.customerPrivilegesActive === false || !profile.user.agreements?.privacyVersion;
    accountProfileForm.elements.accountNotices.checked = Boolean(
      profile.user.notificationPreferences?.accountNotices,
    );
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
  async function refreshCustomerPaymentMethods() {
    if (!customerPaymentPanel || !customerPaymentList) return;
    const response = await fetch("/api/account/payment-methods", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error?.message || "Saved cards could not be loaded.");
    savedPaymentMethods = payload.paymentMethods || [];
    customerPaymentList.replaceChildren(...savedPaymentMethods.map((method) => {
      const card = document.createElement("article"),
        detail = document.createElement("p"),
        actions = document.createElement("div");
      card.className = "product-card__body";
      const expiry = method.expirationMonth && method.expirationYear
        ? `Expires ${String(method.expirationMonth).padStart(2, "0")}/${method.expirationYear}`
        : "Expiration is held by Stripe";
      detail.textContent = `${method.cardholderName || "Card"} · ${String(method.brand || "Card").replaceAll("_", " ")} ending ${method.last4} · ${expiry}${method.id === payload.defaultId ? " · Default" : ""}`;
      actions.className = "creator-onboarding-actions";
      if (method.id !== payload.defaultId) {
        const makeDefault = document.createElement("button");
        makeDefault.type = "button";
        makeDefault.className = "button button--secondary";
        makeDefault.textContent = "Make Default";
        makeDefault.dataset.paymentAction = "set_default";
        makeDefault.dataset.paymentMethodId = method.id;
        actions.append(makeDefault);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button--secondary";
      remove.textContent = "Remove Card";
      remove.dataset.paymentAction = "remove";
      remove.dataset.paymentMethodId = method.id;
      actions.append(remove);
      card.append(detail, actions);
      return card;
    }));
    const profileResponse = await fetch("/api/account/profile", { credentials: "same-origin" });
    const account = await profileResponse.json().catch(() => ({}));
    const billing = account.user?.billing || {};
    const hasProfile = Boolean(account.user?.displayName && billing.firstName && billing.lastName && billing.addressLine1 && billing.city && billing.stateRegion && billing.postalCode && billing.country && account.user.agreements?.termsVersion && account.user.agreements?.privacyVersion);
    customerPaymentForm.hidden = !hasProfile;
    if (!hasProfile) {
      customerPaymentGuidance.textContent = "Complete and save the required profile, billing information, and agreements before setting up a card.";
      return;
    }
    customerPaymentGuidance.textContent = savedPaymentMethods.length
      ? "Card data is held by Stripe. Tobacco Road Games stores only the secure payment reference and card display details. No registration fee is charged."
      : "Register one card to activate Customer access. Card data is held by Stripe; Tobacco Road Games stores only the secure payment reference and card display details. No registration fee is charged.";
    const heading = document.querySelector("#customer-payment-method-form-heading");
    if (heading) heading.textContent = savedPaymentMethods.length ? "Add another card" : "Register your initial card";
  }
  customerPaymentList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-payment-action]");
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.paymentAction === "remove" && !window.confirm("Remove this saved card from your account?")) return;
      const result = await api("/api/account/payment-methods", {
        action: button.dataset.paymentAction,
        paymentMethodId: button.dataset.paymentMethodId,
      });
      customerPaymentStatus.textContent = button.dataset.paymentAction === "remove" ? "Saved card removed." : "Default card updated.";
      await refreshCustomerPaymentMethods();
    } catch (error) {
      customerPaymentStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  customerPaymentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      if (!form.elements.savePaymentMethod.checked) throw Error("Authorize saving this card to continue.");
      if (!activeSetupAttemptId) {
        activeSetupAttemptId = crypto.randomUUID();
        const setup = await api("/api/account/payment-methods", {
          action: "create_setup",
          idempotencyKey: activeSetupAttemptId,
          savePaymentMethod: true,
        });
        await loadStripeJs();
        stripeInstance = window.Stripe(setup.publishableKey);
        stripeElements = stripeInstance.elements({ clientSecret: setup.clientSecret });
        paymentElement = stripeElements.create("payment");
        customerPaymentElementHost.replaceChildren();
        paymentElement.mount(customerPaymentElementHost);
        sessionStorage.setItem("trg.customerPaymentAttempt", activeSetupAttemptId);
        form.dataset.setupClientSecret = setup.clientSecret;
        customerPaymentStatus.textContent = "Secure card form ready. Enter the card details and save.";
        submit.textContent = "Save Payment Method";
        submit.disabled = false;
        return;
      }
      const profile = await fetch("/api/account/profile", { credentials: "same-origin" }).then((r) => r.json());
      const billing = profile.user?.billing || {};
      const result = await stripeInstance.confirmSetup({
        elements: stripeElements,
        clientSecret: form.dataset.setupClientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/account.html?payment_setup_return=1`,
          payment_method_data: {
            billing_details: {
              name: form.elements.cardholderName.value.trim(),
              address: {
                line1: billing.addressLine1,
                line2: billing.addressLine2 || undefined,
                city: billing.city,
                state: billing.stateRegion,
                postal_code: billing.postalCode,
                country: billing.country,
              },
            },
            allow_redisplay: "always",
          },
        },
        redirect: "if_required",
      });
      if (result.error) throw Error(result.error.message || "Stripe could not save this card.");
      if (result.setupIntent?.status !== "succeeded") throw Error("Complete the card verification step before continuing.");
      await finishCustomerPaymentSetup(activeSetupAttemptId, result.setupIntent.id);
    } catch (error) {
      customerPaymentStatus.textContent = error.message || "Card registration could not be completed.";
    } finally {
      submit.disabled = false;
    }
  });

  async function finishCustomerPaymentSetup(attemptId, setupIntentId) {
    const result = await api("/api/account/payment-methods", {
      action: "confirm_setup", attemptId, setupIntentId,
    });
    sessionStorage.removeItem("trg.customerPaymentAttempt");
    activeSetupAttemptId = "";
    customerPaymentForm.reset();
    delete customerPaymentForm.dataset.setupClientSecret;
    paymentElement?.unmount();
    paymentElement = null;
    stripeElements = null;
    customerPaymentStatus.textContent = result.activated
      ? "Card saved. Customer access is active; opening your storefront."
      : "Card saved. Customer access activates after email verification.";
    const active = await refreshAccount();
    if (active) window.location.assign("/customer");
  }

  async function loadStripeJs() {
    if (window.Stripe) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(Error("Secure Stripe card entry could not be loaded."));
      document.head.append(script);
    });
    if (!window.Stripe) throw Error("Secure Stripe card entry is unavailable.");
  }

  accountProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = event.currentTarget;
    try {
      await api("/api/account/profile", {
        legalName: f.legalName.value,
        birthday: f.birthday.value || null,
        displayName: f.displayName.value,
        avatarUrl: f.avatarUrl.value,
        firstName: f.firstName.value,
        lastName: f.lastName.value,
        company: f.company.value,
        addressLine1: f.addressLine1.value,
        addressLine2: f.addressLine2.value,
        city: f.city.value,
        stateRegion: f.stateRegion.value,
        postalCode: f.postalCode.value,
        country: f.country.value,
        acceptTerms: f.acceptTerms.checked,
        acknowledgePrivacy: f.acknowledgePrivacy.checked,
        notificationPreferences: { accountNotices: f.accountNotices.checked },
      });
      await refreshCustomerProfile();
      await refreshCustomerPaymentMethods();
      accountProfileStatus.textContent = "Customer profile and billing information saved.";
    } catch (error) {
      accountProfileStatus.textContent = error.message;
    }
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

  window.addEventListener("load", () =>
    window.setTimeout(scheduleGoogleInitialization, 100),
  );
  refreshAccount()
    .then(() => {
      scheduleGoogleInitialization();
      return handleUrlTokens();
    })
    .catch(() => {
      setStatus("Account service is not available yet.", true);
    });
  if (window.__TRG_ACCOUNT_TEST__) {
    Object.assign(window.__TRG_ACCOUNT_TEST__, {
      defaultLandingForAccount,
      initializeGoogle,
      scheduleGoogleInitialization,
    });
  }
})();
