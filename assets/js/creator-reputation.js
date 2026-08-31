document.querySelectorAll('[data-creator-reputation]').forEach(async (root) => {
  const creator = root.dataset.creatorReputation;
  try {
    const response = await fetch(`/api/creator-reputation?creator=${encodeURIComponent(creator)}`, { credentials: 'same-origin' });
    if (!response.ok) return;
    const payload = await response.json(), compact = root.dataset.reputationView === 'compact';
    root.replaceChildren();
    const badges = document.createElement('div'); badges.className = 'creator-badges'; badges.setAttribute('aria-label', 'Creator badges');
    for (const badge of payload.badges.prominent) { const item=document.createElement('span'); item.className=`creator-badge creator-badge--${badge.category.replace('_','-')}`; item.textContent=badge.title; item.title=badge.description; item.setAttribute('aria-label',badge.accessibleLabel); badges.append(item); }
    if (!compact && payload.badges.overflowCount) { const more=document.createElement('span'); more.className='creator-badge-overflow'; more.textContent=`+${payload.badges.overflowCount} more`; badges.append(more); }
    const rating=document.createElement('p'); rating.className='creator-rating'; rating.setAttribute('aria-label', payload.rating.state==='rated' ? `Creator rating ${payload.rating.average} out of 5 from ${payload.rating.count} verified customers` : payload.rating.label); rating.textContent=payload.rating.state==='rated' ? `★ ${payload.rating.label}` : payload.rating.label;
    root.append(badges,rating); root.classList.toggle('creator-reputation--founding',payload.badges.hasFoundingHalo);
  } catch {}
});
