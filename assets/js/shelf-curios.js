(() => {
  const movable = [...document.querySelectorAll('[data-curio-behavior="movable"]')];
  const fixed = [...document.querySelectorAll('[data-curio-behavior="fixed"]')];
  if (!movable.length && !fixed.length) return;
  const status = document.querySelector('[data-curio-status]');
  const saved = new Map();
  let csrfToken = '';
  let ready = false;
  let held = null;
  let starting = false;
  let saving = false;
  let refreshing = false;
  const clamp = value => Math.max(0, Math.min(1, value));
  const announce = message => { if (status) status.textContent = message; };

  async function api(url, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: body ? { 'content-type': 'application/json', 'x-csrf-token': csrfToken } : { accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || 'The shelf is unavailable.'), { payload, status: response.status });
      return payload;
    } finally { clearTimeout(timeout); }
  }

  function place(node, position) {
    const shelf = node.closest('[data-curio-shelf]');
    const width = node.getBoundingClientRect().width;
    if (!shelf || !width) return;
    const gutter = 8;
    const travel = Math.max(0, shelf.clientWidth - width - gutter * 2);
    node.style.left = `${gutter + width / 2 + travel * clamp(position.x)}px`;
    // Feet stay on the existing 24px shelf deck, never floating on the back wall.
    node.style.bottom = `calc(var(--shop-wall-bric-surface-height) - ${24 * clamp(position.y)}px)`;
  }

  function accept(curio) {
    const node = movable.find(item => item.dataset.curioId === curio?.id && item.closest('[data-curio-shelf]')?.dataset.curioShelf === curio.shelfId);
    if (!node || !Number.isFinite(curio.x) || !Number.isFinite(curio.y) || !Number.isSafeInteger(curio.revision)) return;
    saved.set(curio.id, curio);
    if (held?.node === node && held.revision !== curio.revision) {
      cancel();
      announce('This curio was moved or reset. Its current position has been restored.');
    }
    if (held?.node !== node) place(node, curio);
    node.setAttribute('aria-disabled', 'false');
  }

  async function refresh() {
    if (!movable.length || refreshing || saving || document.hidden) return;
    refreshing = true;
    try {
      const payload = await api('/api/curios');
      if (!Array.isArray(payload.curios)) throw new Error('The shelf is unavailable.');
      csrfToken = payload.csrfToken || '';
      payload.curios.forEach(accept);
      ready = movable.every(node => saved.has(node.dataset.curioId));
    } catch {
      ready = false;
    } finally { refreshing = false; }
  }

  function cancel() {
    if (!held) return;
    const { node, shelf } = held;
    held = null;
    node.setAttribute('aria-pressed', 'false');
    delete shelf.dataset.curioHeld;
    if (saved.has(node.dataset.curioId)) place(node, saved.get(node.dataset.curioId));
  }

  function pickUp(node, event) {
    if (starting || saving) return;
    if (!ready) { announce('The shelf is unavailable. Please try again.'); return; }
    starting = true;
    try {
      const position = saved.get(node.dataset.curioId);
      const shelf = node.closest('[data-curio-shelf]');
      const box = node.getBoundingClientRect();
      held = {
        node, shelf, revision: position.revision, x: position.x, y: position.y,
        startX: event.detail ? event.clientX : box.x + box.width / 2,
        startY: event.detail ? event.clientY : box.y + box.height / 2,
        originalX: position.x, originalY: position.y
      };
      node.setAttribute('aria-pressed', 'true');
      shelf.dataset.curioHeld = 'true';
      announce(`${position.name} picked up.`);
    } catch { announce('The shelf is unavailable. Please try again.'); }
    finally { starting = false; }
  }

  function follow(event) {
    if (!held) return;
    const bounds = held.shelf.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    const width = held.node.getBoundingClientRect().width;
    const travel = Math.max(1, held.shelf.clientWidth - width - 16);
    held.x = clamp(held.originalX + (event.clientX - held.startX) / travel);
    held.y = clamp(held.originalY + (event.clientY - held.startY) / 24);
    place(held.node, held);
  }

  async function putDown() {
    if (!held || saving) return;
    const draft = held;
    held = null;
    delete draft.shelf.dataset.curioHeld;
    draft.node.setAttribute('aria-pressed', 'false');
    draft.node.setAttribute('aria-busy', 'true');
    saving = true;
    try {
      const payload = await api('/api/curios', { id: draft.node.dataset.curioId, revision: draft.revision, x: draft.x, y: draft.y });
      accept(payload.curio);
      announce('Curio placed.');
    } catch (error) {
      if (error.payload?.curio) accept(error.payload.curio);
      else place(draft.node, saved.get(draft.node.dataset.curioId));
      announce(error.message || 'The position could not be saved.');
    } finally {
      saving = false;
      draft.node.removeAttribute('aria-busy');
      await refresh();
    }
  }

  for (const node of movable) {
    node.setAttribute('aria-disabled', 'true');
    node.addEventListener('click', event => {
      event.stopPropagation();
      if (held?.node === node) putDown();
      else if (!held) pickUp(node, event);
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); }
      if (held?.node !== node) return;
      const directions = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        held.x = clamp(held.x + direction[0]);
        held.y = clamp(held.y + direction[1]);
        place(node, held);
      }
    });
    node.addEventListener('load', () => { const position = saved.get(node.dataset.curioId); if (position) place(node, position); });
  }
  document.addEventListener('pointermove', follow);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('click', event => {
    if (!held) return;
    const bounds = held.shelf.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
      follow(event);
      putDown();
    } else cancel();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { cancel(); announce('Move cancelled.'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); else refresh(); });
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', () => movable.forEach(node => { const position = held?.node === node ? held : saved.get(node.dataset.curioId); if (position) place(node, position); }));
  if (movable.length) {
    refresh();
    let poll = setInterval(refresh, 20000);
    window.addEventListener('pagehide', () => { cancel(); clearInterval(poll); poll = null; });
    window.addEventListener('pageshow', () => { refresh(); if (!poll) poll = setInterval(refresh, 20000); });
  }

  // Fixed curios are deliberately local effects: no API calls, position writes, or saved timers.
  for (const node of fixed) {
    if (node.dataset.curioEffect !== 'tardis') continue;
    const light = node.querySelector('[data-curio-light]');
    if (!light) continue;
    let active = false;
    let deadline = 0;
    let wake;
    let returning = false;
    let animations = [];
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reset = () => {
      clearTimeout(wake);
      animations.forEach(animation => animation.cancel());
      animations = [];
      node.style.opacity = '';
      node.style.pointerEvents = '';
      node.removeAttribute('aria-busy');
      node.removeAttribute('data-curio-away');
      active = false;
      returning = false;
    };
    const flashLight = () => light.animate(reducedMotion()
      ? [{ opacity: 0.55 }, { opacity: 0.55 }]
      : [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }], {
      duration: reducedMotion() ? 5000 : 1000, iterations: reducedMotion() ? 1 : 5
    });
    const returnHome = async () => {
      if (!active || returning || !node.hasAttribute('data-curio-away') || Date.now() < deadline) return;
      returning = true;
      try {
        const fadeIn = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reducedMotion() ? 0 : 1000, fill: 'forwards' });
        animations.forEach(animation => animation.cancel());
        animations = [fadeIn];
        await fadeIn.finished;
        const flash = flashLight();
        animations.push(flash);
        await flash.finished;
      } catch {}
      reset();
    };
    const run = async () => {
      if (active) return;
      active = true;
      node.setAttribute('aria-busy', 'true');
      const flash = flashLight();
      animations.push(flash);
      try {
        await flash.finished;
        flash.cancel();
        const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 0 : 1000, fill: 'forwards' });
        animations.push(fade);
        await fade.finished;
        node.style.opacity = '0';
        node.style.pointerEvents = 'none';
        node.dataset.curioAway = 'true';
        deadline = Date.now() + 120000;
        wake = setTimeout(returnHome, 120000);
      } catch { reset(); }
    };
    node.addEventListener('click', run);
    node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) returnHome(); });
    window.addEventListener('pagehide', reset);
  }
})();
