(() => {
  const search = document.getElementById("listing-search"),
    query = document.getElementById("listing-query"),
    state = document.getElementById("listing-state"),
    status = document.getElementById("maintenance-status"),
    listingsRoot = document.getElementById("listing-results"),
    filesRoot = document.getElementById("file-results"),
    filePanel = document.getElementById("file-panel"),
    listingContext = document.getElementById("listing-context");

  search.addEventListener("submit", (event) => { event.preventDefault(); loadListings(); });
  loadListings();

  async function loadListings() {
    status.textContent = "Loading listings…";
    const params = new URLSearchParams({ q: query.value.trim(), state: state.value });
    try {
      const payload = await request(`/owner/api/listing-files?${params}`);
      listingsRoot.replaceChildren(...payload.listings.map(listingCard));
      status.textContent = `${payload.listings.length} listing${payload.listings.length === 1 ? "" : "s"} found.`;
    } catch (error) { status.textContent = error.message; }
  }

  function listingCard(listing) {
    const card = node("article", "listing-row"), heading = node("h2", "", listing.title),
      details = node("p", "", `${listing.creator_name} (${listing.creator_slug}) · listing ${listing.id}`),
      states = node("p", "", `Lifecycle ${listing.lifecycle_state} · publication ${listing.publication_state} · saleability ${listing.owner_review_hold ? "OWNER REVIEW HOLD" : listing.inactivity_state || "active"} · media ${listing.media_type || "unspecified"}`),
      button = node("button", "button button--secondary", "Inspect Files"),
      control = node("button", "button button--secondary", listing.owner_review_hold ? "Restore Listing" : "Delist for Review");
    button.type = "button"; button.addEventListener("click", () => loadFiles(listing.id));
    control.type = "button"; control.addEventListener("click", () => listing.owner_review_hold ? restoreListing(listing) : holdListing(listing));
    card.append(heading, details, states);
    if (listing.owner_review_hold) card.append(node("p", "status-note", `Held ${formatDate(listing.owner_review_hold_started_at)} · ${listing.owner_review_hold_reason}${listing.owner_review_hold_corrective_action_expected ? " · corrective action expected" : ""}`));
    card.append(button, control); return card;
  }

  async function holdListing(listing) {
    const reason = prompt(`Creator-visible reason for delisting ${listing.title}:`, "");
    if (!reason?.trim()) return;
    const correctiveActionExpected = confirm("Is corrective action expected from the Creator?");
    try { await request("/owner/api/listing-files", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ action: "place_review_hold", listingId: listing.id, reason, correctiveActionExpected }) }); await loadListings(); status.textContent = "Listing placed on Owner Review Hold."; }
    catch (error) { status.textContent = error.message; }
  }

  async function restoreListing(listing) {
    if (!confirm(`Clear the Owner Review Hold for ${listing.title}? Other listing restrictions will remain in effect.`)) return;
    try { await request("/owner/api/listing-files", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ action: "restore_review_hold", listingId: listing.id }) }); await loadListings(); status.textContent = "Owner Review Hold cleared. Normal saleability rules still apply."; }
    catch (error) { status.textContent = error.message; }
  }

  async function loadFiles(listingId) {
    status.textContent = "Loading stored files…";
    try {
      const payload = await request(`/owner/api/listing-files?listingId=${encodeURIComponent(listingId)}`);
      const listing = payload.listing;
      listingContext.replaceChildren(node("p", "", `${listing.creator_name} · ${listing.title} · ${listing.id} · lifecycle ${listing.lifecycle_state} · publication ${listing.publication_state}`));
      filesRoot.replaceChildren(...payload.files.map((file) => fileCard(file)));
      if (!payload.files.length) filesRoot.append(node("p", "maintenance-note", "No file records are associated with this listing."));
      filePanel.hidden = false; filePanel.scrollIntoView({ behavior: "smooth", block: "start" });
      status.textContent = `${payload.files.length} stored file record${payload.files.length === 1 ? "" : "s"} loaded.`;
    } catch (error) { status.textContent = error.message; }
  }

  function fileCard(file) {
    const card = node("article", "file-row"), heading = node("h3", "", `${file.purpose}: ${file.normalized_filename}`),
      details = node("p", "", `${file.content_type} · ${formatBytes(file.size_bytes)} · uploaded ${formatDate(file.uploaded_at)}`),
      states = node("p", "", `Record ${file.validation_state} · storage ${file.storageState} · secure delivery ${file.secureDeliveryState}`),
      diagnostic = node("p", "", file.delivery_object_key ? `Delivery key: ${file.delivery_object_key}` : "No promoted delivery key"),
      download = document.createElement("a");
    download.className = "button button--secondary"; download.href = file.downloadUrl; download.textContent = "Secure Download";
    card.append(heading, details, states, diagnostic, download);
    if (file.validation_state === "accepted") {
      const form = node("form", "replacement"), label = node("label", "", "Validated replacement file"), input = document.createElement("input"), button = node("button", "button button--primary", "Replace File");
      input.type = "file"; input.required = true; input.accept = file.purpose === "product" ? "application/pdf,.pdf" : file.purpose === "cover" || file.purpose === "preview" ? "image/webp,.webp" : "application/pdf,image/webp,image/png,image/jpeg,.pdf,.webp,.png,.jpg,.jpeg";
      label.append(input); button.type = "submit"; form.append(label, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); if (!input.files[0]) return;
        if (!confirm(`Replace the current ${file.purpose} file with ${input.files[0].name}? Existing customers will receive the new current file.`)) return;
        button.disabled = true; status.textContent = "Validating and replacing file…";
        const data = new FormData(); data.set("listingId", file.listing_id); data.set("fileId", file.id); data.set("file", input.files[0]);
        try { await request("/owner/api/listing-files", { method: "POST", headers: { "x-csrf-token": csrf() }, body: data }); await loadFiles(file.listing_id); status.textContent = "Replacement stored, verified, and recorded."; }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      card.append(form);
    }
    return card;
  }
  async function request(url, options = {}) { const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options }), payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error?.message || payload.error || "Owner file maintenance request failed."); return payload; }
  function csrf() { return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("trg_owner_csrf="))?.slice("trg_owner_csrf=".length) || ""; }
  function node(tag, className, text) { const value=document.createElement(tag); if(className)value.className=className; if(text!==undefined)value.textContent=text; return value; }
  function formatBytes(value) { const bytes=Number(value)||0; if(bytes<1024)return `${bytes} B`; if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1048576).toFixed(1)} MB`; }
  function formatDate(value) { const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown date"; }
})();
