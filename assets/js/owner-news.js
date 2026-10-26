(function () {
  const status = document.getElementById('status');
  async function api(body) {
    const response = await fetch('/owner/api/news', { credentials: 'same-origin', method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'News request failed.');
    return payload;
  }
  function button(label, operation) { const b = document.createElement('button'); b.className = 'button button--secondary'; b.type = 'button'; b.textContent = label; b.onclick = () => api(operation).then(load).catch((error) => { status.textContent = error.message; }); return b; }
  async function load() {
    try {
      const payload = await api();
      const sources = document.getElementById('sources');
      sources.replaceChildren(...payload.sources.map((source) => { const row = document.createElement('p'); row.textContent = `${source.displayName} (${source.enabled ? 'enabled' : 'disabled'}) `; row.append(button(source.enabled ? 'Disable' : 'Enable', { operation: 'source', id: source.id, enabled: !source.enabled })); if (source.termsUrl) { const a = document.createElement('a'); a.href = source.termsUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Terms'; row.append(' ', a); } return row; }));
      const items = document.getElementById('items');
      items.replaceChildren(...payload.items.map((item) => { const row = document.createElement('article'); row.className = 'note-card'; const h = document.createElement('h3'); h.textContent = item.headline; const p = document.createElement('p'); p.textContent = `${item.source_name} · ${item.status} · priority ${item.priority}`; const link = document.createElement('a'); link.href = item.article_url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open source'; row.append(h, p, link, ' ', button(item.status === 'archived' ? 'Archived' : 'Archive', { operation: 'update', id: item.id, status: 'archived' })); return row; }));
    } catch (error) { status.textContent = error.message; }
  }
  document.getElementById('announcement').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api({ ...data, priority: Number(data.priority), expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : undefined }); event.currentTarget.reset(); status.textContent = 'Announcement published.'; await load(); } catch (error) { status.textContent = error.message; } });
  load();
}());
