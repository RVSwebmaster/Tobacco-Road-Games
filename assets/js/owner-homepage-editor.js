(function () {
  const featured = document.getElementById("homepage-featured");
  const wip = document.getElementById("homepage-wip");
  const publish = document.getElementById("homepage-publish");
  const status = document.getElementById("homepage-status");

  Promise.all([
    fetch("/data/products.json", { cache: "no-store" }).then(checkResponse),
    fetch("/data/homepage.json", { cache: "no-store" }).then(checkResponse)
  ]).then(([products, config]) => {
    const listed = products.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
    featured.innerHTML = '<option value="">Choose a featured title</option>' + listed.map((product) =>
      `<option value="${escapeHtml(product.slug)}">${escapeHtml(product.title)}</option>`).join("");
    featured.value = config.featuredSlug || listed.find((product) => product.featured)?.slug || "";
    const selected = new Set(config.workInProgressSlugs || []);
    wip.innerHTML = listed.map((product) => `<label class="homepage-editor__choice"><input type="checkbox" value="${escapeHtml(product.slug)}"${selected.has(product.slug) ? " checked" : ""}> <span>${escapeHtml(product.title)}</span></label>`).join("");
  }).catch((error) => { status.textContent = `Could not load current selections. ${error.message}`; publish.disabled = true; });

  publish.addEventListener("click", async () => {
    if (!featured.value) { status.textContent = "Choose one featured title before publishing."; featured.focus(); return; }
    const csrf = getCookie("trg_owner_csrf");
    if (!csrf) { status.textContent = "Your security token is missing. Reload this page and try again."; return; }
    publish.disabled = true; status.textContent = "Publishing homepage selections…";
    try {
      const response = await fetch("/owner/api/homepage", { method: "POST", headers: { "content-type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ featuredSlug: featured.value, workInProgressSlugs: [...wip.querySelectorAll('input:checked')].map((input) => input.value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Publish failed.");
      status.innerHTML = escapeHtml(result.message) + (result.runUrl ? ` <a href="${escapeHtml(result.runUrl)}" target="_blank" rel="noopener">View workflow</a>` : "");
    } catch (error) { status.textContent = error.message; } finally { publish.disabled = false; }
  });

  function checkResponse(response) { if (!response.ok) throw new Error(`Request failed (${response.status}).`); return response.json(); }
  function getCookie(name) { const prefix = `${name}=`; return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || ""; }
  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
})();
