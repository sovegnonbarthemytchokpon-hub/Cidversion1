// schedule.js
// Handles schedule modal rendering and toggle (extracted from main.js)

const scheduleTranslate = (key, fallback = key) => (
  window.cidTranslation?.t?.(key, fallback) || fallback
);
const scheduleInterpolate = (key, values, fallback) => (
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
    scheduleTranslate(key, fallback)
  )
);

export function renderSchedule() {
  const body = document.getElementById('scheduleBody');
  if (!body) return;
  // dynamic rules based on current date/time to keep the modal accurate
  const now = new Date();
  const timeZone = 'Africa/Abidjan';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  const abidjanToday = new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day')
  ));
  const abidjanDay = abidjanToday.getUTCDay();
  const rules = [
    { genDay: 0, key: 'sunday', note: 'Dimanche → Généré samedi à 16:00 avec la date du dimanche' },
    { genDay: 1, key: 'monday', note: 'Lundi → Généré dimanche à 16:00 avec la date du lundi' },
    { genDay: 2, key: 'tuesday', note: 'Mardi → Généré lundi à 16:00 avec la date du mardi' },
    { genDay: 3, key: 'wednesday', note: 'Mercredi → Généré mardi à 16:00 avec la date du mercredi' },
    { genDay: 4, key: 'thursday', note: 'Jeudi → Généré mercredi à 16:00 avec la date du jeudi' },
    { genDay: 5, key: 'friday', note: 'Vendredi → Généré jeudi à 16:00 avec la date du vendredi' },
    { genDay: 6, key: 'saturday', note: 'Samedi → Généré vendredi à 16:00 avec la date du samedi' }
  ];
  let html = `<div style="margin-bottom:10px;font-weight:700;color:#0A1840">${
    scheduleTranslate(
      'schedule.title',
      "Horaires des programmes — s'applique à toutes les catégories, y compris la Croix nationale"
    )
  }</div><ul style="list-style:none;padding:0;margin:0;">`;
  rules.forEach(rule => {
    const target = new Date(abidjanToday);
    const delta = (rule.genDay - abidjanDay + 7) % 7;
    target.setUTCDate(abidjanToday.getUTCDate() + delta);
    const genDate = new Date(target);
    genDate.setUTCDate(target.getUTCDate() - 1);
    genDate.setUTCHours(16, 0, 0, 0);
    if (genDate.getTime() <= now.getTime()) {
      genDate.setUTCDate(genDate.getUTCDate() + 7);
      target.setUTCDate(target.getUTCDate() + 7);
    }
    const dateStr = target.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone
    });
    const genStr = genDate.toLocaleString(window.cidTranslation?.current?.() || 'fr', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone
    });
    html += `<li style="padding:8px 0;border-bottom:1px solid #eee">
      <strong style="display:block;color:#0A1840">${dateStr}</strong>
      <div style="font-size:0.95em;color:#333">${scheduleTranslate(`schedule.${rule.key}`, rule.note)}</div>
      <div style="margin-top:6px;color:#666">${
        scheduleInterpolate(
          'schedule.nextGeneration',
          { date: genStr },
          'Prochaine génération pour ce jour : {{date}}'
        )
      }</div>
    </li>`;
  });
  html += '</ul>';
  body.innerHTML = html;
}

export function toggleSchedule(open) {
  const modal = document.getElementById('scheduleModal');
  if (!modal) return;
  const isOpen = modal.classList.contains('open');
  const shouldOpen = (typeof open === 'boolean') ? open : !isOpen;
  if (shouldOpen) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    window.cidSetDocumentScrollLocked?.(true);
    renderSchedule();
    setTimeout(() => { const btn = document.getElementById('scheduleClose'); if (btn) btn.focus(); }, 100);
  } else {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    window.cidResetScrollLock?.({ resetSurfaces: false });
  }
}

// Shared entry point for the Accueil feed. The existing schedule renderer and
// modal remain the source of truth; this only lets a feed card open them.
window.cidOpenSchedule = () => toggleSchedule(true);
window.renderSchedule = renderSchedule;

// wire close button
const closeBtn = document.getElementById('scheduleClose');
if (closeBtn) closeBtn.addEventListener('click', () => toggleSchedule(false));
document.addEventListener('click', (e) => { const modal = document.getElementById('scheduleModal'); if (modal && e.target === modal) toggleSchedule(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('scheduleModal')?.classList.contains('open')) toggleSchedule(false); });
