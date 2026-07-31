(() => {
  document.querySelectorAll(".forum-moderation-action").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    if (!button) return;
    const status = form.querySelector('[role="status"]');
    button.disabled = true;
    status.textContent = "Applying moderation action...";
    try {
      const account = await (await fetch("/api/account/me", { credentials: "same-origin" })).json();
      const reportAction = button.value === "resolve_report" || button.value === "dismiss_report";
      const response = await fetch("/api/forum/moderation/actions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": account.csrfToken }, body: JSON.stringify({ action: button.value, reason: form.elements.reason.value, targetId: reportAction ? form.dataset.reportId : form.dataset.targetId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "The moderation action failed.");
      window.location.reload();
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  }));
})();
