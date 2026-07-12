(() => {
  const form = document.querySelector("#ad-upload-form");
  const video = document.querySelector("#video");
  const filename = document.querySelector("#filename");
  const overwrite = document.querySelector("#overwrite");
  const button = document.querySelector("#upload-button");
  const progress = document.querySelector("#upload-progress");
  const status = document.querySelector("#upload-status");
  const result = document.querySelector("#upload-result");
  const getCookie = (name) => document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  const safeName = (value) => `${String(value).replace(/\.mp4$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100)}.mp4`;
  video.addEventListener("change", () => { if (video.files[0]) filename.value = safeName(video.files[0].name); });
  form.addEventListener("submit", (event) => {
    event.preventDefault(); result.textContent = "";
    const file = video.files[0];
    if (!file || file.type !== "video/mp4" || file.size > 100 * 1024 * 1024) { status.textContent = "Choose an MP4 no larger than 100 MB."; return; }
    const body = new FormData(); body.set("video", file); body.set("filename", safeName(filename.value)); body.set("overwrite", overwrite.checked ? "true" : "false");
    const csrf = getCookie("trg_owner_csrf"); if (!csrf) { status.textContent = "Your security token is missing. Reload the page and sign in again."; return; }
    button.disabled = true; progress.hidden = false; progress.value = 0; status.textContent = "Uploading…";
    const xhr = new XMLHttpRequest(); xhr.open("POST", "/owner/api/ads"); xhr.withCredentials = true; xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress.value = Math.round(e.loaded / e.total * 100); };
    xhr.onload = () => { let payload = {}; try { payload = JSON.parse(xhr.responseText); } catch {} if (xhr.status >= 200 && xhr.status < 300) { const url = new URL(payload.url, location.origin).href; status.textContent = "Upload complete."; const a = document.createElement("a"); a.href = url; a.textContent = url; result.replaceChildren("Direct URL: ", a); } else status.textContent = payload.error || `Upload failed (HTTP ${xhr.status}).`; button.disabled = false; };
    xhr.onerror = () => { status.textContent = "The upload connection failed. Try again."; button.disabled = false; }; xhr.send(body);
  });
})();
