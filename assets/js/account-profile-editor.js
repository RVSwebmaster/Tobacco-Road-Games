(() => {
  const profileFields = ["legalName", "birthday", "phone", "displayName", "avatarUrl"];

  function fill(form, user = {}) {
    if (!form) return;
    for (const key of profileFields) {
      if (form.elements[key]) form.elements[key].value = user[key] || "";
    }
    if (form.elements.accountNotices) {
      form.elements.accountNotices.checked = Boolean(user.notificationPreferences?.accountNotices);
    }
  }

  function values(form) {
    return {
      legalName: form.elements.legalName?.value || "",
      birthday: form.elements.birthday?.value || null,
      phone: form.elements.phone?.value || "",
      displayName: form.elements.displayName?.value || "",
      avatarUrl: form.elements.avatarUrl?.value || "",
      notificationPreferences: {
        accountNotices: Boolean(form.elements.accountNotices?.checked),
      },
    };
  }

  function attach({ form, status, save }) {
    if (!form || typeof save !== "function" || form.dataset.profileEditorReady) return;
    form.dataset.profileEditorReady = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"], button:not([type])');
      if (button) button.disabled = true;
      if (status) status.textContent = "Saving your account information…";
      try {
        const result = await save(values(form));
        fill(form, result?.user);
        if (status) status.textContent = "Account information saved.";
      } catch (error) {
        if (status) status.textContent = error.message || "Account information could not be saved.";
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  window.TRGAccountProfileEditor = Object.freeze({ attach, fill });
})();
