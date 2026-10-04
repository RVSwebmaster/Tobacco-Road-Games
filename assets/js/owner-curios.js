(() => {
  const button = document.querySelector('[data-curio-reset]');
  const status = document.querySelector('[data-curio-owner-status]');
  const counts = document.querySelector('[data-curio-counts]');
  const position = (x, y) => `${Math.round(x * 100)}%, ${Math.round(y * 100)}%`;
  const cookie = name => document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1) || '';

  function rows(selector, values) {
    const body = document.querySelector(selector);
    body.replaceChildren();
    for (const valuesForRow of values) {
      const row = document.createElement('tr');
      for (const value of valuesForRow) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }

  async function load(reset = false) {
    button.disabled = true;
    try {
      const response = await fetch('/owner/api/curios', {
        method: reset ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: reset ? { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(cookie('trg_owner_csrf')) } : { accept: 'application/json' },
        ...(reset ? { body: JSON.stringify({ action: 'reset' }) } : {})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The shelf controls are unavailable.');
      rows('[data-curio-arrangement]', payload.curios.map(curio => [curio.name, curio.shelfId, position(curio.x, curio.y), curio.revision]));
      rows('[data-curio-activity]', payload.activity.map(event => [
        new Date(event.created_at).toLocaleString(), event.curio_id,
        event.actor_id.startsWith('visitor:') ? `Visitor ${event.actor_id.slice(8, 16)}` : event.actor_name || event.actor_id,
        event.action, position(event.from_x, event.from_y), position(event.to_x, event.to_y)
      ]));
      counts.textContent = `${payload.counts.moves} moves / ${payload.counts.participants} participant accounts or browsers`;
      status.textContent = reset ? 'Original arrangement restored.' : payload.activity.length ? '' : 'No activity yet.';
      button.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }

  button.addEventListener('click', () => {
    if (confirm('Restore all movable curios to their original positions?')) load(true);
  });
  load();
})();
