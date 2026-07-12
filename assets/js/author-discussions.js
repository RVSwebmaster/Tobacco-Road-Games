(() => {
  const root = document.querySelector("[data-author-discussions]");
  if (!root) return;
  const authorSlug = root.dataset.authorSlug;
  const form = root.querySelector("[data-discussion-form]");
  const list = root.querySelector("[data-discussion-list]");
  const status = root.querySelector("[data-discussion-status]");

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const dateLabel = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "";

  async function load() {
    try {
      const response = await fetch(`/api/discussions?author=${encodeURIComponent(authorSlug)}`, { headers: { accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Discussions could not be loaded.");
      render(payload.threads || []);
    } catch (error) {
      list.innerHTML = `<p class="discussion-status discussion-status--error">${escapeHtml(error.message)}</p>`;
    }
  }

  function render(threads) {
    if (!threads.length) {
      list.innerHTML = "<p>No discussions yet. You can be the first to leave a message.</p>";
      return;
    }
    list.innerHTML = threads.map((thread) => `
      <article class="discussion-thread">
        <header><h3>${escapeHtml(thread.subject)}</h3><span>${dateLabel(thread.last_activity_at)}</span></header>
        <div class="discussion-comments">
          ${thread.comments.map((comment) => `
            <article class="discussion-comment${comment.is_author ? " discussion-comment--author" : ""}">
              <p class="discussion-comment__meta"><strong>${escapeHtml(comment.display_name)}</strong>${comment.is_author ? '<span class="author-response-badge">Author</span>' : ""}<time>${dateLabel(comment.published_at || comment.created_at)}</time></p>
              <p>${escapeHtml(comment.body)}</p>
            </article>
          `).join("")}
        </div>
        ${thread.status === "open" ? `<form class="discussion-reply-form" data-reply-form data-thread-id="${thread.public_id}">
          <div class="discussion-form__fields"><label>Display name<input class="dock-input" name="displayName" maxlength="60" required></label><label>Email address<input class="dock-input" name="email" type="email" maxlength="254" required></label></div>
          <label>Reply<textarea class="dock-input" name="message" rows="3" maxlength="4000" required></textarea></label>
          <label class="discussion-consent"><input name="notificationsAccepted" type="checkbox" required> I agree to receive required discussion notifications.</label>
          <button class="button button--secondary" type="submit">Verify Email and Reply</button><p class="discussion-status" role="status"></p>
        </form>` : "<p>This discussion is closed.</p>"}
      </article>`).join("");
  }

  async function submit(targetForm, extra = {}) {
    const output = targetForm.querySelector(".discussion-status");
    const data = new FormData(targetForm);
    const payload = { authorSlug, displayName: data.get("displayName"), email: data.get("email"), subject: data.get("subject"), message: data.get("message"), notificationsAccepted: data.get("notificationsAccepted") === "on", ...extra };
    output.textContent = "Submitting…";
    try {
      const response = await fetch("/api/discussions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your message could not be submitted.");
      targetForm.reset();
      output.textContent = result.message;
    } catch (error) {
      output.textContent = error.message;
      output.classList.add("discussion-status--error");
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); submit(form); });
  list.addEventListener("submit", (event) => { const reply = event.target.closest("[data-reply-form]"); if (!reply) return; event.preventDefault(); submit(reply, { threadId: reply.dataset.threadId }); });
  load();
})();
