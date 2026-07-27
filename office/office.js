const state = { folderId: null, projectId: null, projects: [] };
const $ = (selector) => document.querySelector(selector);

await loadProjects();

$("#new-project").addEventListener("click", async () => {
  const name = prompt("Project name");
  if (!name) return;
  await mutate("/office/api/projects", { name });
  await loadProjects();
});

$("#new-folder").addEventListener("click", async () => {
  const name = prompt("Folder name");
  if (!name) return;
  await mutate("/office/api/folders", {
    name, parentId: state.folderId, projectId: state.projectId
  });
  await loadFolder();
});

$("#file-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) await upload(files);
});

$("#trash-button").addEventListener("click", showTrash);

async function loadProjects() {
  try {
    const data = await api("/office/api/projects");
    state.projects = data.projects;
    $("#projects").replaceChildren(...data.projects.map((project) => {
      const button = element("button", project.name);
      button.className = project.id === state.projectId ? "active" : "";
      button.addEventListener("click", () => selectProject(project.id));
      return button;
    }));
    if (state.projectId && !data.projects.some((item) => item.id === state.projectId)) {
      state.projectId = null;
      state.folderId = null;
    }
  } catch (error) { notice(error.message, true); }
}

async function selectProject(id) {
  state.projectId = id;
  state.folderId = null;
  await loadProjects();
  await loadFolder();
}

async function loadFolder(folderId = state.folderId) {
  state.folderId = folderId;
  const query = new URLSearchParams({ projectId: state.projectId });
  if (folderId) query.set("folderId", folderId);
  try {
    const data = await api(`/office/api/browse?${query}`);
    renderBreadcrumbs(data.folder);
    renderListing(data);
    $("#new-folder").disabled = false;
    $("#file-input").disabled = false;
    $("#file-input").closest("label").setAttribute("aria-disabled", "false");
  } catch (error) { notice(error.message, true); }
}

function renderBreadcrumbs(folder) {
  const project = state.projects.find((item) => item.id === state.projectId);
  const projectButton = element("button", project?.name || "Project");
  projectButton.addEventListener("click", () => loadFolder(null));
  const nodes = [projectButton];
  if (folder) nodes.push(document.createTextNode(" / "), element("button", folder.name));
  $("#breadcrumbs").replaceChildren(...nodes);
}

function renderListing(data) {
  const rows = [
    ...data.folders.map((folder) => listingRow(folder, "folder")),
    ...data.files.map((file) => listingRow(file, "file"))
  ];
  $("#listing tbody").replaceChildren(...rows);
  $("#listing").hidden = !rows.length;
  $("#empty").hidden = Boolean(rows.length);
  $("#empty").textContent = "This folder is empty.";
}

function listingRow(item, type) {
  const row = document.createElement("tr");
  const nameCell = document.createElement("td");
  const open = element("button", `${type === "folder" ? "📁" : "📄"} ${item.name}`);
  open.className = "name-button";
  open.addEventListener("click", () => type === "folder" ? loadFolder(item.id) : showFile(item.id));
  nameCell.append(open);
  const size = element("td", type === "file" ? formatBytes(item.byte_size) : "—");
  const modified = element("td", formatDate(item.updated_at));
  const actions = document.createElement("td");
  actions.className = "row-actions";
  if (type === "file") {
    const version = element("button", "New version");
    version.addEventListener("click", () => chooseVersion(item));
    actions.append(version);
  }
  const remove = element("button", "Trash");
  remove.addEventListener("click", async () => {
    if (!confirm(`Move “${item.name}” to trash?`)) return;
    await api(`/office/api/${type}s/${item.id}`, {
      headers: { "x-csrf-token": cookie("trg_office_csrf") },
      method: "DELETE"
    });
    await loadFolder();
  });
  actions.append(remove);
  row.append(nameCell, size, modified, actions);
  return row;
}

function chooseVersion(file) {
  const input = document.createElement("input");
  input.type = "file";
  input.addEventListener("change", () => input.files[0] && upload([input.files[0]], file));
  input.click();
}

async function upload(files, existingFile = null) {
  const status = $("#upload-status");
  status.hidden = false;
  try {
    const descriptors = [];
    for (let index = 0; index < files.length; index += 1) {
      status.textContent = `Hashing ${index + 1} of ${files.length}: ${files[index].name}`;
      descriptors.push({
        contentType: files[index].type || "application/octet-stream",
        fileId: existingFile?.id,
        name: files[index].name,
        sha256: await sha256(files[index]),
        size: files[index].size
      });
    }
    const route = existingFile
      ? `/office/api/files/${existingFile.id}/versions`
      : "/office/api/uploads";
    const body = existingFile
      ? { file: descriptors[0], folderId: existingFile.folder_id, projectId: state.projectId }
      : { files: descriptors, folderId: state.folderId, projectId: state.projectId };
    const reservation = await mutate(route, body);
    for (let index = 0; index < reservation.items.length; index += 1) {
      const item = reservation.items[index];
      status.textContent = `Uploading ${index + 1} of ${files.length}: ${files[index].name}`;
      const response = await fetch(item.uploadUrl, {
        body: files[index],
        credentials: "same-origin",
        headers: {
          ...item.uploadHeaders,
          "x-csrf-token": cookie("trg_office_csrf")
        },
        method: "PUT"
      });
      if (!response.ok) throw new Error(`R2 rejected ${files[index].name} (${response.status}).`);
    }
    status.textContent = "Verifying and publishing immutable versions…";
    const result = await mutate(`/office/api/uploads/${reservation.batchId}/complete`, {});
    if (result.failed) throw new Error(`${result.failed} file(s) failed storage verification.`);
    status.textContent = `${result.published} immutable version(s) published.`;
    await loadFolder();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

async function showFile(fileId) {
  try {
    const data = await api(`/office/api/files/${fileId}`);
    const title = document.createElement("h2");
    title.textContent = data.file.name;
    const versions = data.versions.map((version) => {
      const row = document.createElement("div");
      row.className = `version${version.is_current ? " current" : ""}`;
      const label = element("span", `Version ${version.version_number} · ${formatBytes(version.byte_size)} · ${formatDate(version.created_at)}`);
      const actions = document.createElement("span");
      const download = element("button", "Download");
      download.addEventListener("click", () => {
        location.href = `/office/api/files/${fileId}/versions/${version.id}/download`;
      });
      actions.append(download);
      if (!version.is_current) {
        const restore = element("button", "Restore");
        restore.addEventListener("click", async () => {
          await mutate(`/office/api/files/${fileId}/restore`, { versionId: version.id });
          await showFile(fileId);
          await loadFolder();
        });
        actions.append(restore);
      }
      row.append(label, actions);
      return row;
    });
    $("#details").replaceChildren(title, ...versions);
    $("#details-dialog").showModal();
  } catch (error) { notice(error.message, true); }
}

async function showTrash() {
  try {
    const data = await api("/office/api/trash");
    const nodes = [];
    for (const type of ["projects", "folders", "files"]) {
      for (const item of data[type]) {
        const row = document.createElement("div");
        row.className = "trash-item";
        const restore = element("button", "Recover");
        restore.addEventListener("click", async () => {
          await mutate(`/office/api/trash/${type}/${item.id}/restore`, {});
          await showTrash();
          await loadProjects();
          if (state.projectId) await loadFolder();
        });
        row.append(element("span", `${type.slice(0, -1)} · ${item.name}`), restore);
        nodes.push(row);
      }
    }
    $("#trash").replaceChildren(...(nodes.length ? nodes : [element("p", "Trash is empty.")]));
    $("#trash-dialog").showModal();
  } catch (error) { notice(error.message, true); }
}

async function mutate(url, body) {
  return api(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-csrf-token": cookie("trg_office_csrf") },
    method: "POST"
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Office request failed (${response.status}).`);
  return data;
}

async function sha256(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(name) {
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}
function element(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "—"; }
function formatBytes(value) { const size = Number(value); if (!size) return "0 B"; const unit = Math.floor(Math.log(size) / Math.log(1024)); return `${(size / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B","KB","MB","GB"][unit]}`; }
function notice(message, error = false) { const node = $("#notice"); node.textContent = message; node.className = `notice${error ? " error" : ""}`; node.hidden = false; }
