(() => {
  const pixelsPerSecond = 24;

  document.querySelectorAll('[data-news-chyron]').forEach((root) => {
    const sequence = root.querySelector('[data-news-sequence]');
    if (!sequence) return;

    const refresh = () => {
      const distance = sequence.getBoundingClientRect().width;
      if (!Number.isFinite(distance) || distance <= 0) return;
      root.style.setProperty('--news-duration', `${distance / pixelsPerSecond}s`);
      root.dataset.newsReady = 'true';
    };

    refresh();
    new ResizeObserver(refresh).observe(sequence);
    document.fonts?.ready.then(refresh);
  });
})();
