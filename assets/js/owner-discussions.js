(() => {
  const root = document.querySelector("[data-owner-discussions]");
  if (!root) return;
  const list = root.querySelector("[data-owner-list]");
  const status = root.querySelector("[data-owner-status]");
  const author = root.dataset.authorSlug;
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const csrf = () => document.cookie.split(";").map((part) => part.trim().split("=")).find(([name]) => name === "trg_owner_csrf")?.[1] || "";

  async function load() {
    const response = await fetch(`/owner/api/discussions?author=${encodeURIComponent(author)}`);
    const payload = await response.json();
    if (!response.ok) { status.textContent = payload.error || "Discussions could not be loaded."; return; }
    list.innerHTML = (payload.threads || []).map((thread) => `<article class="discussion-thread"><h2>${escapeHtml(thread.subject)}</h2>${thread.comments.map((comment) => `<article class="discussion-comment${comment.is_author ? " discussion-comment--author" : ""}"><p><strong>${escapeHtml(comment.display_name)}</strong>${comment.is_author ? " · Author" : ""}</p><p>${escapeHtml(comment.body)}</p></article>`).join("")}<form data-author-reply data-thread-id="${thread.public_id}" class="discussion-reply-form"><label>Official response<textarea class="dock-input" name="message" rows="4" maxlength="4000" required></textarea></label><button class="button button--primary" type="submit">Post Author Response</button><p class="discussion-status" role="status"></p></form></article>`).join("") || "<p>No published discussions.</p>";
  }

  list.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-author-reply]");
    if (!form) return;
    event.preventDefault();
    const output = form.querySelector(".discussion-status");
    output.textContent = "Posting…";
    const response = await fetch("/owner/api/discussions", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf()) }, body: JSON.stringify({ threadId: form.dataset.threadId, message: new FormData(form).get("message") }) });
    const payload = await response.json();
    if (!response.ok) { output.textContent = payload.error || "Response failed."; return; }
    await load();
  });
  load();
})();

