(() => {
  const form = document.querySelector("#forum-topic-form");
  if (!form) return;
  const status = document.querySelector("#forum-topic-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "Creating topic...";
    status.classList.remove("discussion-status--error");
    try {
      const accountResponse = await fetch("/api/account/me", { credentials: "same-origin" });
      const account = await accountResponse.json();
      if (!account.authenticated || !account.csrfToken) throw new Error("Sign in again before creating a topic.");
      const response = await fetch("/api/forum/topics", {
        body: JSON.stringify({ body: form.elements.body.value, categorySlug: form.dataset.categorySlug, title: form.elements.title.value }),
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": account.csrfToken },
        method: "POST"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "The topic could not be created.");
      window.location.assign(payload.topic.url);
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("discussion-status--error");
      submit.disabled = false;
    }
  });
})();
