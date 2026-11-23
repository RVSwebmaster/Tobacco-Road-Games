(() => {
  const form = document.getElementById("founding25-form");
  const status = document.getElementById("founding25-status");
  const history = document.getElementById("founding25-history");
  if (!form || !status || !history) return;
  let csrfToken = "";
  const cell = value => { const td = document.createElement("td"); td.textContent = value == null ? "" : String(value); return td; };
  async function load() {
    const response = await fetch("/owner/api/founding25", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Assignment history could not be loaded.");
    csrfToken = payload.csrfToken || "";
    status.textContent = `${payload.activeCount} of ${payload.limit} active or reserved assignments.`;
    history.replaceChildren(...payload.assignments.map(item => {
      const row = document.createElement("tr");
      row.append(cell(`${item.display_name} (${item.creator_id})`), cell(item.revoked_at ? "Revoked" : "Active/reserved"),
        cell(item.effective_at), cell(item.revoked_at), cell(item.reason));
      return row;
    }));
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const action = String(data.get("action"));
    const expected = action === "assign" ? "ASSIGN FOUNDING-25" : "REVOKE FOUNDING-25";
    if (String(data.get("confirmation")) !== expected || !confirm(`${expected} for Creator ${data.get("creatorId")}?`)) return;
    status.textContent = "Applying audited Owner action…";
    try {
      const response = await fetch("/owner/api/founding25", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ action, creatorId: data.get("creatorId"), reason: data.get("reason"), confirmation: data.get("confirmation") }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The action was rejected.");
      form.reset(); await load(); status.textContent += " Last action recorded in the Creator financial audit.";
    } catch (error) { status.textContent = error.message; }
  });
  load().catch(error => { status.textContent = error.message; });
})();
