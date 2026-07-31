(() => {
  const form = document.querySelector("#forum-reply-form");
  if (!form) return;
  const submit = form.querySelector('button[type="submit"]');
  const status = document.querySelector("#forum-reply-status");
  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    submit.disabled = true;
    status.textContent = "Posting reply...";
    status.classList.remove("discussion-status--error");
    try {
      const accountResponse = await fetch("/api/account/me", { credentials: "same-origin" });
      const account = await accountResponse.json();
      if (!account.authenticated || !account.csrfToken) throw new Error("Sign in again before posting a reply.");
      const response = await fetch(`/api/forum/topic/${encodeURIComponent(form.dataset.topicId)}/replies`, {
        body: JSON.stringify({ body: form.elements.body.value }), credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": account.csrfToken }, method: "POST"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "The reply could not be posted.");
      form.reset();
      window.location.assign(`${form.dataset.topicUrl}?reply=posted#post-${encodeURIComponent(payload.reply.id)}`);
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("discussion-status--error");
      submit.disabled = false;
      submitting = false;
    }
  });
})();
