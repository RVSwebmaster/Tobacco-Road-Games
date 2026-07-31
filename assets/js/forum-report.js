(() => {
  document.querySelectorAll(".forum-report-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]'), status = form.querySelector('[role="status"]');
    button.disabled = true; status.textContent = "Sending report...";
    try {
      const account = await (await fetch("/api/account/me", { credentials: "same-origin" })).json();
      const response = await fetch(form.action, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": account.csrfToken }, body: JSON.stringify({ reason: form.elements.reason.value, explanation: form.elements.explanation.value }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "The report could not be sent.");
      form.reset(); status.textContent = "Report received for moderator review.";
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  }));
})();
