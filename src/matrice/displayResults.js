function escapeMatrixHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function matrixColumnValues(value) {
  const entries = Array.isArray(value)
    ? value
    : value === null || value === undefined
      ? []
      : [value];
  return entries
    .flatMap((entry) => (
      entry && typeof entry === 'object' ? Object.values(entry) : [entry]
    ))
    .flatMap((entry) => String(entry ?? '').split(/[\s,;·|/]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderMatrixColumn(label, value, className) {
  const values = matrixColumnValues(value);
  if (!values.length) return '';
  return `
    <div class="${className}">
      <h4>${escapeMatrixHtml(label)}</h4>
      <div class="matrix-number-column">${values
        .map((entry) => `<span>${escapeMatrixHtml(entry)}</span>`)
        .join('')}</div>
    </div>`;
}

function renderMatrixDetails(lottery) {
  const columns = [
    renderMatrixColumn('Matrice', lottery.matrix, 'matrix'),
    renderMatrixColumn('Clavier', lottery.keyboard, 'keyboard'),
    renderMatrixColumn('Cerveau', lottery.cerveau, 'cerveau')
  ].filter(Boolean).join('');
  const metadata = [
    ['Code', lottery.code],
    ['Event', lottery.event]
  ]
    .filter(([, value]) => String(value ?? '').trim())
    .map(([label, value]) => `<span>${label}: ${escapeMatrixHtml(value)}</span>`)
    .join('');
  return `
    ${columns ? `<div class="matrix-keyboard-container">${columns}</div>` : ''}
    ${metadata ? `<div class="matrix-publication-meta">${metadata}</div>` : ''}`;
}

function displayResults(results, containerId = 'results') {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Only render Matrice when the client-side view is active. The dedicated
  // controller uses __currentCategory because the shortcut is a plant button,
  // not a category item.
  const activeCat = document.querySelector('.category-item.active')?.textContent?.trim()?.toLowerCase()
    || window.__currentCategory
    || (document.body.classList.contains('matrice-active') ? 'matrice' : '');
  if (activeCat !== 'matrice') {
    container.innerHTML = '';
    return;
  }
  if (containerId === 'results' && window.selectedMatriceCountry === null) {
    container.innerHTML = '';
    return;
  }
  if (containerId === 'results' && window.__matriceViewOwned) {
    // Matrice has a strict three-level renderer. Legacy callers must not
    // reinsert a fourth, competing list into the active view.
    return;
  }
  results = Array.isArray(results)
    ? results
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        ...item,
        country: typeof item.country === 'string' ? item.country : 'Programme',
        name: typeof item.name === 'string' ? item.name : '',
        matrix: Array.isArray(item.matrix) ? item.matrix : [],
        keyboard: Array.isArray(item.keyboard) ? item.keyboard : [],
        cerveau: Array.isArray(item.cerveau) ? item.cerveau : []
      }))
    : [];

  // Keep the familiar order for existing countries, then include every
  // additional country returned by administrator-configured sources.
  const preferredCountries = ["Côte d'Ivoire", "Niger", "Ghana", "Bénin", "Sénégal", "Togo"];
  const resultCountries = [...new Set(
    results.map((item) => String(item?.country || '').trim()).filter(Boolean)
  )];
  const countries = [
    ...preferredCountries.filter((country) => resultCountries.includes(country)),
    ...resultCountries
      .filter((country) => !preferredCountries.includes(country))
      .sort((left, right) => left.localeCompare(right, 'fr'))
  ];

  let html = '';

  countries.forEach(country => {
    // skip Ghana / Togo on Sunday if no programmes
    if ((country === 'Ghana' || country === 'Togo')) {
      const sample = results.find(r => r.country === country);
      if (sample && sample.date) {
        const parts = sample.date.split('-'); // dd-mm-yyyy
        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        if (d.getDay() === 0) return;
      }
    }

    const countryResults = results.filter(r => r.country === country);
    if (!countryResults.length) return;

    // Group by hour (use "No hour" for entries without hour)
    const groups = {};
    countryResults.forEach(item => {
      const key = (typeof item.hour === 'number') ? String(item.hour).padStart(2,'0') + 'h' : 'No hour';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    // sort group keys with numeric hours first
    const keys = Object.keys(groups).sort((a,b) => {
      if (a === 'No hour') return 1;
      if (b === 'No hour') return -1;
      return parseInt(a,10) - parseInt(b,10);
    });

    // render country header
    const countryId = 'country-' + country.toLowerCase().replace(/\s+/g,'-').replace(/[^\w\-]/g,'');
    html += `<section class="country-section-wrap" id="${countryId}" aria-label="${country}">`;
    html += `<h2 style="margin:8px 0 6px 0;font-weight:900;color:#0A1840">${country}</h2>`;

    // If the country has only "No hour" entries (i.e. no timed programmes), render its programmes directly (expanded).
    const onlyNoHour = keys.length === 1 && keys[0] === 'No hour';

    // each hour becomes a folder the user can click to toggle (unless onlyNoHour -> show directly)
    keys.forEach((k, idx) => {
      const groupId = `${countryId}-grp-${idx}`;
      const label = (k === 'No hour') ? 'Programme' : `${k} — ${groups[k].length} programme${groups[k].length>1?'s':''}`;

      if (onlyNoHour) {
        // Render items directly without a collapsible folder
        groups[k].forEach(lottery => {
          const displayDate = lottery.date || '';
          const displayName = lottery.name || lottery.country;
          html += `<div class="fb-post" role="article" aria-label="${displayName}" style="margin-bottom:10px;border:1px solid rgba(10,24,64,0.04);border-radius:10px;padding:12px;background:#fff;">`;
          html += `<header class="fb-post-header" style="display:flex;gap:12px;align-items:center;padding:0 0 8px 0;">`;
          html += `<div class="fb-avatar" aria-hidden="true" style="width:40px;height:40px;border-radius:8px;background:#eef2ff"></div>`;
          html += `<div style="display:flex;flex-direction:column;">`;
          html += `<div style="font-weight:800;color:#0A1840">${displayName}</div>`;
          html += `<div style="font-size:12px;color:#666">${displayDate}</div>`;
          html += `</div></header>`;
          html += `<div class="fb-post-body" style="padding:6px 0;">`;
          html += renderMatrixDetails(lottery);
          html += `</div>`; // fb-post-body
          html += `<footer style="padding-top:8px;display:flex;justify-content:flex-end;"><button class="copy-button" onclick="copySingleLottery('${(lottery.country||'').replace(/'/g, "\\'")}', '${(displayName||'').replace(/'/g, "\\'")}', '${(displayDate||'').replace(/'/g, "\\'")}', ${JSON.stringify(lottery.matrix)}, ${JSON.stringify(lottery.keyboard||[])}, ${JSON.stringify(lottery.cerveau||[])}, '${lottery.code||''}', '${lottery.event||''}')">Copier</button></footer>`;
          html += `</div>`; // fb-post
        });
      } else {
        // create collapsible folder for timed programmes
        html += `<div class="programme-folder" style="border:1px solid rgba(10,24,64,0.04);border-radius:10px;margin-bottom:8px;overflow:hidden;">`;
        html += `<button type="button" aria-expanded="false" aria-controls="${groupId}" class="folder-toggle" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;border:0;font-weight:900;cursor:pointer;">`;
        html += `<span style="text-align:left">${label}</span><span style="opacity:0.7">▶</span></button>`;
        // hidden content
        html += `<div id="${groupId}" class="folder-content" style="display:none;padding:12px;background:#fafafa;">`;
        // render each programme in this hour group as a compact card
        groups[k].forEach(lottery => {
          const displayDate = lottery.date || '';
          const displayName = lottery.name || lottery.country;
          html += `<div class="fb-post" role="article" aria-label="${displayName}" style="margin-bottom:10px;">`;
          html += `<header class="fb-post-header" style="display:flex;gap:12px;align-items:center;padding:8px 0;">`;
          html += `<div class="fb-avatar" aria-hidden="true" style="width:40px;height:40px;border-radius:8px;background:#eef2ff"></div>`;
          html += `<div style="display:flex;flex-direction:column;">`;
          html += `<div style="font-weight:800;color:#0A1840">${displayName}</div>`;
          html += `<div style="font-size:12px;color:#666">${displayDate}</div>`;
          html += `</div></header>`;
          html += `<div class="fb-post-body" style="padding:6px 0;">`;
          html += renderMatrixDetails(lottery);
          html += `</div>`; // fb-post-body
          html += `<footer style="padding-top:8px;display:flex;justify-content:flex-end;"><button class="copy-button" onclick="copySingleLottery('${(lottery.country||'').replace(/'/g, "\\'")}', '${(displayName||'').replace(/'/g, "\\'")}', '${(displayDate||'').replace(/'/g, "\\'")}', ${JSON.stringify(lottery.matrix)}, ${JSON.stringify(lottery.keyboard||[])}, ${JSON.stringify(lottery.cerveau||[])}, '${lottery.code||''}', '${lottery.event||''}')">Copier</button></footer>`;
          html += `</div>`; // fb-post
        });
        html += `</div>`; // folder-content
        html += `</div>`; // programme-folder
      }
    });

    html += `</section>`;
  });

  container.innerHTML = html || '<p class="matrice-empty">Aucun programme disponible.</p>';

  // wire folder toggles (deferred to DOM run)
  container.querySelectorAll('.programme-folder .folder-toggle').forEach(btn => {
    const icon = btn.querySelector('span:last-child');
    const targetId = btn.getAttribute('aria-controls');
    const content = document.getElementById(targetId);
    btn.addEventListener('click', () => {
      const opened = content.style.display !== 'none';
      content.style.display = opened ? 'none' : 'block';
      btn.setAttribute('aria-expanded', String(!opened));
      if (icon) icon.textContent = opened ? '▶' : '▼';
      // smooth scroll into view when opening
      if (!opened) {
        setTimeout(() => { try { content.scrollIntoView({behavior:'smooth', block:'start'}); } catch(_){} }, 120);
      }
    });
  });
}

// Explicit bridge for module-based controllers. Function declarations in a
// classic script are global in browsers, but the bridge also documents and
// stabilizes that contract.
window.displayResults = displayResults;

/* helper: copy single lottery publication (used by copy button in each fb-post) */
window.copySingleLottery = function(country, name, date, matrix, keyboard, cerveau, code, event) {
  const formatDate = (value) => {
    const rawDate = String(value ?? '').trim();
    const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
    const dmyMatch = rawDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    return dmyMatch
      ? `${dmyMatch[1].padStart(2, '0')}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[3]}`
      : rawDate;
  };
  const valuesAsLines = (values) => (
    Array.isArray(values)
      ? values.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
  );
  const lines = [
    String(name || country || 'Programme').replace(/\s*Cidmap\s*$/i, '').trim(),
    formatDate(date),
    'Matrice',
    ...valuesAsLines(matrix)
  ];
  if (Array.isArray(keyboard) && keyboard.length) lines.push('Clavier', ...valuesAsLines(keyboard));
  if (Array.isArray(cerveau) && cerveau.length) lines.push('Cerveau', ...valuesAsLines(cerveau));
  lines.push(`Code: ${code || ''}`, `Event: ${event || ''}`);
  const text = lines.join('\n').replace(/\nCidmap\s*$/i, '').trim();
  navigator.clipboard.writeText(text.trim()).then(() => {
    alert(`Publication de ${name} copiée !`);
  }).catch(err => {
    console.error('Erreur copie :', err);
    alert('Impossible de copier la publication.');
  });
};
