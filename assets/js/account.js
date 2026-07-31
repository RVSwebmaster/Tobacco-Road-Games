(() => {
  const status = document.querySelector("#account-status");
  const summary = document.querySelector("#account-summary");
  const signout = document.querySelector("#signout-button");
  const resend = document.querySelector("#resend-verification-button");
  const resetPanel = document.querySelector("#reset-panel");
  const resetForm = document.querySelector("#reset-form");
  let csrfToken = "";

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
    setStatus("Account loaded.");
  }

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
    const cookie = document.cookie.split("; ").find((part) => part.startsWith("g_csrf_token="));
    const gCsrf = cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
    try {
      await api("/api/auth/google", {
        credential: credentialResponse.credential,
        g_csrf_token: gCsrf
      });
      await refreshAccount();
      setStatus("Signed in with Google.");
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  function initializeGoogle() {
    const clientId = document.documentElement.dataset.googleClientId || window.TRG_GOOGLE_CLIENT_ID || "";
    const unavailable = document.querySelector("#google-unavailable");
    if (!clientId || !window.google?.accounts?.id) {
      if (unavailable) unavailable.hidden = false;
      return;
    }
    window.google.accounts.id.initialize({
      callback: window.handleTrgGoogleCredential,
      client_id: clientId
    });
    window.google.accounts.id.renderButton(document.querySelector("#google-signin-control"), {
      size: "large",
      text: "continue_with",
      theme: "outline",
      type: "standard"
    });
  }

  window.addEventListener("load", () => window.setTimeout(initializeGoogle, 100));
  refreshAccount().then(() => {
    initializeGoogle();
    return handleUrlTokens();
  }).catch(() => {
    setStatus("Account service is not available yet.", true);
  });
})();
