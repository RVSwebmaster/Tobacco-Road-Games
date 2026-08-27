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
  const accountProfilePanel=document.querySelector('#account-profile-panel'),accountProfileForm=document.querySelector('#account-profile-form'),accountProfileStatus=document.querySelector('#account-profile-status'),creatorRegistrationPanel=document.querySelector('#creator-registration-panel'),creatorRegistrationForm=document.querySelector('#creator-registration-form'),creatorRegistrationStatus=document.querySelector('#creator-registration-status');
  let preparedAvatar = null;
  let previewObjectUrl = "";
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
      if (libraryPanel) libraryPanel.hidden = true;
      if(accountProfilePanel)accountProfilePanel.hidden=true;if(creatorRegistrationPanel)creatorRegistrationPanel.hidden=true;
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
    refreshLibrary().catch((error) => {
      if (libraryStatus) libraryStatus.textContent = error.message;
    });
    refreshRegistrationPanels().catch(error=>{if(accountProfileStatus)accountProfileStatus.textContent=error.message;});
    setStatus("Account loaded.");
  }

  async function refreshLibrary() {
    if (!libraryPanel || !libraryList || !libraryStatus) return;
    libraryPanel.hidden = false;
    libraryStatus.textContent = "Loading your library...";
    const response = await fetch("/api/account/library", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "My Library could not be loaded.");
    libraryList.replaceChildren();
    if (!payload.items?.length) {
      libraryStatus.textContent = "Your library is empty. Digital purchases made while signed in will appear here.";
      return;
    }
    for (const item of payload.items) {
      const card = document.createElement("article");
      card.className = "product-card";
      const body = document.createElement("div");
      body.className = "product-card__body";
      const title = document.createElement("h3");
      title.className = "product-card__title";
      title.textContent = item.productTitle;
      const creator = document.createElement("p");
      creator.className = "product-card__meta";
      creator.textContent = item.creator ? `By ${item.creator}` : "Creator information unavailable";
      const order = document.createElement("p");
      order.className = "product-card__meta";
      order.textContent = `Order ${item.orderReference} · ${new Date(item.purchaseDate).toLocaleDateString()}`;
      body.append(title, creator, order);
      if (item.downloadUrl) {
        const link = document.createElement("a");
        link.className = "button button--primary";
        link.href = item.downloadUrl;
        link.textContent = "Download";
        body.append(link);
      } else {
        const note = document.createElement("p");
        note.className = "product-card__meta";
        note.textContent = item.downloadAvailable ? "Download access is temporarily unavailable." : "No active download entitlement.";
        body.append(note);
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
      const url = new URL(recoveryForm.elements.accessLink.value, window.location.origin);
      const credential = url.searchParams.get("credential") || "";
      if (!credential) throw new Error("Paste the complete order-access link from your delivery email.");
      const payload = await api("/api/account/claim-order", { credential });
      recoveryStatus.textContent = payload.message;
      recoveryForm.reset();
      await refreshLibrary();
    } catch (error) {
      recoveryStatus.textContent = error.message;
      recoveryStatus.classList.add("discussion-status--error");
    }
  });

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
      avatarEditor.hidden = false;
      avatarHandle.textContent = `@${profile.handle}`;
      avatarPreview.src = profile.avatarUrl || "/assets/logo.png?v=forum-avatar-default";
      avatarDelete.hidden = !profile.avatarUrl;
      avatarPresets?.querySelectorAll('input[name="avatarPreset"]').forEach((input) => { input.checked = input.value === profile.avatarPresetId; });
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
      setAvatarStatus("That image could not be prepared. Choose a PNG, JPEG, or WebP image.", true);
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
    const response = await fetch("/api/forum/profile/avatar", { body: jsonBody ? JSON.stringify(jsonBody) : blob || undefined, credentials: "same-origin", headers, method });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "The avatar request could not be completed.");
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
    return (await canvasBlob(canvas, "image/webp", 0.9)) || (await canvasBlob(canvas, "image/png"));
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("invalid image")); };
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

  async function refreshRegistrationPanels(){accountProfilePanel.hidden=false;const profile=await fetch('/api/account/profile',{credentials:'same-origin'}).then(async r=>{const p=await r.json();if(!r.ok)throw Error(p.error?.message||'Account profile unavailable.');return p;});for(const key of ['legalName','birthday','phone','displayName','avatarUrl'])if(accountProfileForm.elements[key])accountProfileForm.elements[key].value=profile.user[key]||'';accountProfileForm.elements.accountNotices.checked=Boolean(profile.user.notificationPreferences?.accountNotices);const registration=await fetch('/api/creator-registration',{credentials:'same-origin'}).then(r=>r.json());creatorRegistrationPanel.hidden=Boolean(registration.ownedCreators?.some(x=>x.identity_type==='primary'));if(!creatorRegistrationPanel.hidden)creatorRegistrationForm.elements.contactEmail.value=profile.user.email;}
  accountProfileForm?.addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;try{await api('/api/account/profile',{legalName:f.legalName.value,birthday:f.birthday.value||null,phone:f.phone.value,displayName:f.displayName.value,avatarUrl:f.avatarUrl.value,notificationPreferences:{accountNotices:f.accountNotices.checked}});accountProfileStatus.textContent='Private account profile saved.';}catch(error){accountProfileStatus.textContent=error.message;}});
  creatorRegistrationForm?.addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,d=Object.fromEntries(new FormData(f));d.acceptAgreement=f.acceptAgreement.checked;d.confirmRights=f.confirmRights.checked;try{const result=await api('/api/creator-registration',d);creatorRegistrationStatus.textContent=`Creator identity ${result.slug} registered. Payout and payment-method setup remain separate.`;await refreshRegistrationPanels();}catch(error){creatorRegistrationStatus.textContent=error.message;}});

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
