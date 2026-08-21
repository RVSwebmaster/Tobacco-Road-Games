(function () {
  const featured = document.getElementById("homepage-featured");
  const wip = document.getElementById("homepage-wip");
  const publish = document.getElementById("homepage-publish");
  const status = document.getElementById("homepage-status");
  let savedSelection = "";

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
    savedSelection = serializeSelection();
    setButtonState("ready");
    featured.addEventListener("change", markDirty);
    wip.addEventListener("change", markDirty);
  }).catch((error) => { setStatus(`Could not load current selections. ${error.message}`, "error"); setButtonState("error"); });

  publish.addEventListener("click", async () => {
    if (!featured.value) { setStatus("Choose one featured title before publishing.", "error"); featured.focus(); return; }
    const csrf = getCookie("trg_owner_csrf");
    if (!csrf) { setStatus("Your security token is missing. Reload this page and try again.", "error"); return; }
    setButtonState("publishing"); setStatus("Publishing homepage selections…", "working");
    try {
      const response = await fetch("/owner/api/homepage", { method: "POST", headers: { "content-type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ featuredSlug: featured.value, workInProgressSlugs: [...wip.querySelectorAll('input:checked')].map((input) => input.value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Publish failed.");
      const selectedTitles = [...wip.querySelectorAll('input:checked')].map((input) => input.closest("label")?.innerText.trim() || input.value);
      const selectionMessage = selectedTitles.length ? ` Work in Progress: ${selectedTitles.join(", ")}.` : " Work in Progress is cleared.";
      savedSelection = serializeSelection();
      setButtonState("success");
      status.dataset.state = "success";
      status.innerHTML = `<strong>Saved and published.</strong> ${escapeHtml(result.message + selectionMessage)}` + (result.runUrl ? ` <a href="${escapeHtml(result.runUrl)}" target="_blank" rel="noopener">View workflow</a>` : "") + ' <a href="/" target="_blank" rel="noopener">View public homepage</a>';
    } catch (error) { setButtonState("dirty"); setStatus(error.message, "error"); }
  });

  function markDirty() {
    if (serializeSelection() === savedSelection) { setButtonState("ready"); setStatus("", ""); return; }
    setButtonState("dirty");
    setStatus("You have unpublished homepage changes.", "working");
  }

  function serializeSelection() {
    return JSON.stringify({ featuredSlug: featured.value, workInProgressSlugs: [...wip.querySelectorAll('input:checked')].map((input) => input.value).sort() });
  }

  function setButtonState(stateName) {
    publish.dataset.state = stateName;
    publish.disabled = stateName !== "dirty";
    publish.textContent = ({ loading: "Loading Current Selections…", ready: "Selections Are Up to Date", dirty: "Publish Homepage Changes", publishing: "Publishing…", success: "Published ✓", error: "Publishing Unavailable" })[stateName];
  }

  function setStatus(message, stateName) {
    status.textContent = message;
    if (stateName) status.dataset.state = stateName; else delete status.dataset.state;
  }

  function checkResponse(response) { if (!response.ok) throw new Error(`Request failed (${response.status}).`); return response.json(); }
  function getCookie(name) { const prefix = `${name}=`; return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || ""; }
  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
})();
