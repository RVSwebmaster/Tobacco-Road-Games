(() => {
  const dialog = document.getElementById("guest-login");
  const trigger = document.querySelector('.site-nav a[href="/account.html"]');
  if (!dialog?.showModal || !trigger) return;

  const form = dialog.querySelector("form");
  const submit = form.querySelector('[type="submit"]');
  const error = dialog.querySelector(".guest-login__error");
  const rememberKey = "trg-guest-login-email";

  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", dialog.id);
  trigger.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      const savedEmail = localStorage.getItem(rememberKey);
      if (savedEmail) form.elements.email.value = savedEmail;
      form.elements.remember.checked = Boolean(savedEmail);
    } catch {
      // Login also works when storage is unavailable.
    }
    dialog.showModal();
  });

  dialog.querySelector(".guest-login__close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    form.elements.password.value = "";
    error.hidden = true;
    trigger.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    const { email, password, remember } = form.elements;
    const address = email.value.trim();
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, password: password.value })
      });
      const result = await response.json();
      if (!response.ok || !result.user) {
        error.textContent = result.error?.message || "Login could not be completed.";
        error.hidden = false;
        return;
      }
      try {
        if (remember.checked) localStorage.setItem(rememberKey, address);
        else localStorage.removeItem(rememberKey);
      } catch {
        // Remember Me only stores the email when this browser permits it.
      }
      form.reset();
      location.assign(result.user.customerPrivilegesActive === false ? "/account.html" : "/customer");
    } catch {
      error.textContent = "Login could not be completed. Please try again.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();
