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
  const forumVerification = document.querySelector("#forum-profile-verification");
  const forumSubmit = document.querySelector("#forum-profile-submit");
  let csrfToken = "";
  let googleInitialized = false;
  let googleInitializeAttempts = 0;
  const maxGoogleInitializeAttempts = 20;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("discussion-status--error", error);
  };

  async function api(path, body = {}, options = {}) {
    const headers = { "content-type": "application/json" };
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    const response = await fetch(path, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers,
      method: options.method || "POST"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || "The account request could not be completed.");
    }
    return payload;
  }

  async function refreshAccount() {
    const response = await fetch("/api/account/me", { credentials: "same-origin" });
    const payload = await response.json();
    if (payload.googleClientId) {
      window.TRG_GOOGLE_CLIENT_ID = payload.googleClientId;
    }
    csrfToken = payload.csrfToken || "";
    if (!payload.authenticated) {
      summary.textContent = "No account is signed in.";
      signout.hidden = true;
      resend.hidden = true;
      if (forumPanel) forumPanel.hidden = true;
      setStatus("Choose Google, sign in, or create a TRG account.");
      return;
    }
    summary.innerHTML = "";
    const email = document.createElement("p");
    email.textContent = `Signed in as ${payload.user.email}`;
    const verified = document.createElement("p");
    verified.textContent = payload.user.emailVerified ? "Email verified." : "Email not verified yet.";
    summary.append(email, verified);
    signout.hidden = false;
    resend.hidden = payload.user.emailVerified;
    if (forumPanel) {
      forumPanel.hidden = false;
      refreshForumProfile(payload.user.emailVerified).catch((error) => {
        forumProfileStatus.textContent = error.message;
        forumProfileStatus.classList.add("discussion-status--error");
      });
    }
    setStatus("Account loaded.");
  }

  async function refreshForumProfile(emailVerified) {
    const response = await fetch("/api/forum/profile/me", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "Your forum profile could not be loaded.");
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
    }
  }

  let availabilityRequest = 0;
  forumHandle?.addEventListener("input", async () => {
    if (forumHandle.readOnly) return;
    const requestId = ++availabilityRequest;
    const handle = forumHandle.value;
    if (!handle) { forumHandleStatus.textContent = ""; return; }
    const response = await fetch(`/api/forum/handle-availability?handle=${encodeURIComponent(handle)}`, { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== availabilityRequest) return;
    forumHandleStatus.textContent = payload.available ? "That handle is available. Final availability is checked when you create the profile." : (payload?.error?.message || "That handle is not available.");
    forumHandleStatus.classList.toggle("discussion-status--error", !payload.available);
  });

  forumForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const editing = event.currentTarget.dataset.mode === "edit";
    if (editing) delete data.handle;
    try {
      const payload = await api("/api/forum/profile", data, { method: editing ? "PATCH" : "POST" });
      forumProfileStatus.textContent = editing ? "Forum profile saved." : "Forum profile created.";
      forumProfileStatus.classList.remove("discussion-status--error");
      await refreshForumProfile(true);
      if (payload.profile) forumHandleStatus.textContent = `Public profile: /forum/member/${payload.profile.handle}`;
    } catch (error) {
      forumProfileStatus.textContent = error.message;
      forumProfileStatus.classList.add("discussion-status--error");
    }
  });

  document.querySelector("#signin-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/auth/login", data);
      event.currentTarget.reset();
      await refreshAccount();
      setStatus("Signed in.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#register-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/auth/register", data);
      event.currentTarget.reset();
      await refreshAccount();
      setStatus("Account created. Check your email to verify the address.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.querySelector("#forgot-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const payload = await api("/api/auth/request-password-reset", data);
      event.currentTarget.reset();
      setStatus(payload.message || "If that account exists, reset instructions will be sent.");
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

  window.handleTrgGoogleCredential = async (credentialResponse) => {
    try {
      await api("/api/auth/google", {
        credential: credentialResponse.credential
      });
      await refreshAccount();
      setStatus("Signed in with Google.");
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  function initializeGoogle() {
    if (googleInitialized) return true;
    const clientId = document.documentElement.dataset.googleClientId || window.TRG_GOOGLE_CLIENT_ID || "";
    const unavailable = document.querySelector("#google-unavailable");
    const control = document.querySelector("#google-signin-control");
    if (!clientId) {
      if (unavailable) unavailable.hidden = false;
      return false;
    }
    if (!window.google?.accounts?.id) {
      googleInitializeAttempts += 1;
      if (googleInitializeAttempts >= maxGoogleInitializeAttempts && unavailable) {
        unavailable.hidden = false;
      }
      return false;
    }
    if (unavailable) unavailable.hidden = true;
    if (control) control.innerHTML = "";
    window.google.accounts.id.initialize({
      callback: window.handleTrgGoogleCredential,
      client_id: clientId
    });
    window.google.accounts.id.renderButton(control, {
      size: "large",
      text: "continue_with",
      theme: "outline",
      type: "standard"
    });
    googleInitialized = true;
    return true;
  }

  function scheduleGoogleInitialization() {
    if (initializeGoogle()) return;
    if (googleInitializeAttempts < maxGoogleInitializeAttempts && (document.documentElement.dataset.googleClientId || window.TRG_GOOGLE_CLIENT_ID || "")) {
      window.setTimeout(scheduleGoogleInitialization, 250);
    }
  }

  window.addEventListener("load", () => window.setTimeout(scheduleGoogleInitialization, 100));
  refreshAccount().then(() => {
    scheduleGoogleInitialization();
    return handleUrlTokens();
  }).catch(() => {
    setStatus("Account service is not available yet.", true);
  });
  if (window.__TRG_ACCOUNT_TEST__) {
    Object.assign(window.__TRG_ACCOUNT_TEST__, {
      initializeGoogle,
      scheduleGoogleInitialization
    });
  }
})();
