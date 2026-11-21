// Boules rejetées: serveur Supabase + renderer local uniquement.

import {
  fetchRejectedBalls,
  formatRejectedBalls
} from '/src/backend-server/methods/boulesRejeteesMethod.js';
import { getProgrammeDate } from '/src/backend-server/methods/program-clock.js';

let rejectedRequest = null;
let rejectedRequestDate = '';
let latestRejectedPayload = null;
let rejectedViewToken = 0;
// Isolated Anticipé session: { date, payload } or null. Never cached.
let rejectedPreview = null;
const REJECTED_CACHE_MAX_AGE = 36 * 60 * 60 * 1000;

function rejectedIdentity() {
  return String(window.cidAuthCurrentUserId || 'visitor').trim() || 'visitor';
}

function rejectedSignature(payload) {
  try {
    return JSON.stringify([
      payload?.programmeDate,
      payload?.groups,
      payload?.programmes
    ]);
  } catch (_) {
    return '';
  }
}

function rejectedProgrammeDate(value) {
  const explicit = String(value || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  try {
    return getProgrammeDate(new Date()).toISOString().slice(0, 10);
  } catch (_) {
    return '';
  }
}

function rejectedCacheKey(date) {
  return `rejected-balls:${rejectedProgrammeDate(date) || 'current'}`;
}

function historyEntryFor(date) {
  const cache = window.cidHistoryCache;
  const programmeDate = rejectedProgrammeDate(date);
  if (!cache?.read || !cache?.key || !programmeDate) return null;
  const value = cache.read(cache.key({ kind: 'rejected', date: programmeDate }))?.value;
  return value?.groups && value?.meta ? value : null;
}

function readRejectedCache(date) {
  const cache = window.cidComponentRuntime?.cache;
  // Entries are scoped by account so one session never paints another's.
  const stored = cache?.read?.(rejectedCacheKey(date), {
    identity: rejectedIdentity(),
    maxAgeMs: REJECTED_CACHE_MAX_AGE
  });
  if (stored?.value && typeof stored.value === 'object') return stored.value;
  // Fallback: the same server payload pre-recorded by the nine-day history.
  return historyEntryFor(date);
}

function writeRejectedCache(date, payload) {
  if (!payload || typeof payload !== 'object') return;
  window.cidComponentRuntime?.cache?.write?.(
    rejectedCacheKey(date),
    payload,
    { identity: rejectedIdentity(), meta: { programmeDate: rejectedProgrammeDate(date) } }
  );
  // Pre-record the publication in the archive, as Croix nationale does.
  const programmeDate = rejectedProgrammeDate(payload?.programmeDate || date);
  const cache = window.cidHistoryCache;
  if (programmeDate && payload.groups && payload.meta
    && Object.keys(payload.groups).length && cache?.write && cache?.key) {
    try { cache.write(cache.key({ kind: 'rejected', date: programmeDate }), payload); } catch (_) {}
  }
}

/*
 * The inline route shows a clone of #rejectedTableBody. When a background
 * refresh brings different values, update that visible clone in place instead
 * of rebuilding the route (no blank frame, scroll position preserved).
 */
function syncInlineRejectedView(tbody) {
  const inlineBody = document.querySelector('#rejectedInlineMain tbody');
  if (!inlineBody || !tbody || inlineBody === tbody) return;
  /*
   * Same markup as the one already shown: keep the mounted nodes. Rebuilding
   * identical groups reset the country filter for a frame, so the
   * "autres pays" button and the country list below it jumped.
   */
  const sourceHtml = tbody.innerHTML;
  if (inlineBody.__cidSourceHtml === sourceHtml) return;
  inlineBody.__cidSourceHtml = sourceHtml;
  inlineBody.replaceChildren(
    ...Array.from(tbody.childNodes).map((node) => node.cloneNode(true))
  );
  // Apply the country filter in the same task as the paint: groups never
  // appear and then disappear 70 ms later, and the toolbar lands at once.
  try { window.cidSmartCountry?.refresh?.(); } catch (_) {}
}

/*
 * Dedicated Boules rejetées route. The host is built synchronously with its
 * final structure (title, "copier tous", table) BEFORE the data request, so
 * the localStorage / Anticipé payload paints into it in the same frame. The
 * previous flow removed the host, awaited the network, then rebuilt it,
 * which made the buttons and the content blink on every open.
 */
function buildRejectedInlineHost() {
  const container = document.createElement('div');
  container.id = 'rejectedInlineMain';
  container.className = 'rejected-inline-main';
  container.style.cssText = [
    'width:100%',
    'max-width:1200px',
    'margin:12px auto',
    'background:#ffffff',
    'border-radius:12px',
    'padding:12px',
    'box-shadow:0 8px 30px rgba(2,6,23,0.06)'
  ].join(';');

  const title = document.createElement('div');
  title.className = 'rejected-inline-title';
  title.style.cssText = 'font-weight:900;margin-bottom:8px;';
  title.textContent = t('rejected.title', 'Boules rejetées');
  container.appendChild(title);

  const copyControls = document.createElement('div');
  copyControls.className = 'rejected-inline-actions';
  copyControls.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px;';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'copy-button';
  copyButton.textContent = t('rejected.copyAll', 'Copier tous');
  copyButton.addEventListener('click', () => { copyAllRejected(); });
  copyControls.appendChild(copyButton);
  container.appendChild(copyControls);

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'rejected-inline-content';
  const sourceTable = document.getElementById('rejectedTable');
  const table = sourceTable
    ? sourceTable.cloneNode(false)
    : document.createElement('table');
  table.removeAttribute('id');
  if (!sourceTable) table.style.cssText = 'width:100%;border-collapse:collapse;';
  const head = sourceTable?.querySelector('thead');
  if (head) table.appendChild(head.cloneNode(true));
  const tbody = document.createElement('tbody');
  const sourceBody = document.getElementById('rejectedTableBody');
  if (sourceBody) {
    tbody.append(...Array.from(sourceBody.childNodes).map((node) => node.cloneNode(true)));
  }
  table.appendChild(tbody);
  contentWrapper.appendChild(table);
  container.appendChild(contentWrapper);
  return container;
}

export async function mountRejectedInline({ epoch } = {}) {
  const routeEpoch = epoch ?? window.__cidRejectedInlineEpoch;
  const results = document.getElementById('results');
  if (!results) return null;
  const feed = results.querySelector('#cid-home-feed');
  if (feed) {
    feed.hidden = true;
    feed.setAttribute('aria-hidden', 'true');
    feed.style.display = 'none';
  }
  results.querySelector('#cid-home-skeleton')?.setAttribute('hidden', '');

  let host = results.querySelector('#rejectedInlineMain');
  if (!host) {
    // Neutral state first: never show the previous route's values.
    document.getElementById('rejectedTableBody')?.replaceChildren();
    host = buildRejectedInlineHost();
    results.appendChild(host);
  }
  // Open at the top instantly: a smooth scroll here read as a jump.
  results.scrollTop = 0;

  try {
    return await renderRejectedTable({
      programmeDate: window.__cidRequestedProgrammeDate || undefined
    });
  } catch (_) {
    if (routeEpoch !== window.__cidRejectedInlineEpoch) return null;
    syncInlineRejectedView(document.getElementById('rejectedTableBody'));
    return null;
  }
}

const t = (key, fallback = key) => (
  window.cidTranslation?.t?.(key, fallback) || fallback
);
const ti = (key, values = {}, fallback = key) => Object.entries(values).reduce(
  (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
  t(key, fallback)
);
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

function dateForDisplay(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? String(value || '')
    : window.cidTranslation?.formatDate?.(date, {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }) || date.toLocaleDateString(
      window.cidTranslation?.current?.() || document.documentElement?.lang || 'fr',
      {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
      }
    );
}

function renderError(tbody, message) {
  if (!tbody) return;
  tbody.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 2;
  cell.style.cssText = 'padding:16px;color:#666;text-align:center;';
  cell.textContent = message;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function clearRejectedViewDom() {
  const results = document.getElementById('results');
  /*
   * Leave #cid-home-feed and its measured card tree mounted. Only the
   * rejected route's own host is disposable; clearing the shared scroll
   * surface is what previously recreated the white gap on return to Accueil.
   */
  results?.querySelector('#rejectedInlineMain')?.remove();

  document.querySelectorAll('#rejectedInlineMain, #rejectedInlineContainer')
    .forEach((element) => element.remove());
  document.getElementById('rejectedTableBody')?.replaceChildren();
}

function rejectedBannerContext(payload) {
  const selected = String(
    window.cidSmartCountry?.get?.()
      || window.__cidUserCountry
      || localStorage.getItem('firstVisitCountry')
      || ''
  ).trim();
  const country = selected && selected !== 'Tous' && selected !== 'Auto'
    ? selected
    : '';
  const options = country === "Côte d'Ivoire"
    ? [ti('rejected.special', { country }, 'Spécial {{country}}'), t('rejected.ivorianSelection', 'Sélection ivoirienne'), t('rejected.keyOfDay', 'Clé du jour')]
    : country === 'Bénin'
      ? [t('rejected.beninFestival', 'Bonne fête Bénin'), t('rejected.beninSelection', 'Sélection béninoise'), t('rejected.keyOfDay', 'Clé du jour')]
      : country
        ? [ti('rejected.special', { country }, 'Spécial {{country}}'), t('rejected.countrySelection', 'Sélection du pays'), t('rejected.keyOfDay', 'Clé du jour')]
        : [t('rejected.keyOfDay', 'Clé du jour'), t('rejected.daySelection', 'Sélection du jour'), t('rejected.keepNearby', 'À garder près de soi')];
  const hash = Array.from(`${payload?.programmeDate || ''}:${country}`)
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return options[hash % options.length];
}

function rejectedBannerInk(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#ffffff';
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= .03928
      ? channel / 12.92
      : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > .48 ? '#10233f' : '#ffffff';
}

function makeDailyRejectedBanner(payload, color) {
  const banner = document.createElement('div');
  banner.className = 'rejected-day-banner rejected-day-banner--rich';
  banner.style.setProperty('--rejected-day-color', color || '#159b1b');
  banner.style.setProperty('--rejected-day-ink', rejectedBannerInk(color || '#159b1b'));

  const date = new Date(
    `${String(payload?.programmeDate || '').slice(0, 10)}T12:00:00.000Z`
  );
  const weekday = Number.isNaN(date.getTime())
    ? ''
    : window.cidTranslation?.formatDate?.(date, {
      weekday: 'long',
      timeZone: 'Africa/Abidjan'
    }) || date.toLocaleDateString(
      window.cidTranslation?.current?.() || document.documentElement?.lang || 'fr',
      {
      weekday: 'long',
      timeZone: 'Africa/Abidjan'
      }
    );
  const readableWeekday = weekday
    ? weekday.charAt(0).toUpperCase() + weekday.slice(1)
    : '';

  const context = rejectedBannerContext(payload);
  banner.innerHTML = `
    <div class="daily-banner-copy">
      <span class="daily-banner-brand"><span class="daily-banner-brand-mark">✦</span> CIDMAP</span>
      <span class="rejected-day-banner-eyebrow">${escapeHtml(t('rejected.dailyProgram', 'Programme du jour'))}</span>
      <strong class="rejected-day-banner-title">${
        readableWeekday
          ? escapeHtml(ti('rejected.titleForDay', { day: readableWeekday }, 'Boules rejetées de {{day}}'))
          : escapeHtml(t('rejected.title', 'Boules rejetées'))
      }</strong>
      <span class="daily-banner-context">${escapeHtml(context)}</span>
      <small class="rejected-day-banner-date">${dateForDisplay(payload?.programmeDate)}</small>
      <span class="daily-banner-contact"><span aria-hidden="true">◌</span> ${escapeHtml(t('rejected.dailyKey', 'Votre clé du jour'))}</span>
    </div>`;
  return banner;
}

function makeCircleRow(title, numbers, color) {
  const container = document.createElement('div');
  container.className = 'rejected-balls-container rejected-country-card';
  container.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:8px',
    'padding:15px',
    'width:100%',
    'max-width:100%',
    'box-sizing:border-box',
    'margin:0 0 16px'
  ].join(';');

  const titleRow = document.createElement('div');
  titleRow.className = 'rejected-balls-title-row';
  titleRow.style.cssText = [
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
    'gap:8px',
    'width:100%',
    'flex-wrap:wrap'
  ].join(';');

  const titleElement = document.createElement('div');
  titleElement.className = 'rejected-balls-title';
  titleElement.textContent = title;
  titleElement.style.fontWeight = '900';
  titleRow.appendChild(titleElement);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'copy-button rejected-copy-btn';
  copyButton.textContent = ti('rejected.copy', { title }, 'Copier {{title}}');
  copyButton.style.cssText = 'width:fit-content;display:inline-block;padding:8px 15px;';
  // Delegated handler (see below): the inline route displays a DOM clone,
  // which does not carry listeners attached to the original node.
  copyButton.dataset.copyText = `${title}\n${numbers.join('\n')}\n`;
  copyButton.dataset.copyLabel = ti('rejected.copy', { title }, 'Copier {{title}}');
  titleRow.appendChild(copyButton);
  container.appendChild(titleRow);

  const grid = document.createElement('div');
  grid.className = 'rejected-balls-grid';
  grid.style.cssText = [
    'display:flex',
    'flex-wrap:wrap',
    'justify-content:center',
    'align-items:center',
    'gap:8px',
    'width:100%',
    'max-width:100%',
    'margin:0 auto',
    'box-sizing:border-box'
  ].join(';');

  numbers.forEach((number) => {
    const cell = document.createElement('div');
    cell.className = 'circle-cell';
    cell.style.cssText = [
      'width:44px',
      'height:44px',
      'border-radius:50%',
      'background:#fff',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      `border:1.5px solid ${color}`,
      'font-weight:900',
      `color:${color}`,
      'font-size:16px'
    ].join(';');
    cell.textContent = String(number).padStart(2, '0');
    grid.appendChild(cell);
  });

  container.appendChild(grid);
  return container;
}

function renderPayload(tbody, payload) {
  if (!tbody) return;
  const groups = payload.groups || {};
  const illustration = window.getDailyIllustration?.(
    'rejected',
    payload.programmeDate
  );
  const configuredColor = window.getDailyIllustrationColor?.(
    payload.programmeDate
  ) || illustration?.color || '#0962D6';
  const color = window.getOfficialPublicationColor?.(payload.programmeDate)
    || configuredColor;

  tbody.innerHTML = '';

  const bannerRow = document.createElement('tr');
  bannerRow.className = 'rejected-day-banner-row';
  const bannerCell = document.createElement('td');
  bannerCell.colSpan = 2;
  bannerCell.appendChild(makeDailyRejectedBanner(payload, color));
  bannerRow.appendChild(bannerCell);
  tbody.appendChild(bannerRow);

  if (illustration?.src) {
    const imageRow = document.createElement('tr');
    imageRow.className = 'rejected-daily-illustration-row';
    const imageCell = document.createElement('td');
    imageCell.colSpan = 2;
    const image = document.createElement('img');
    image.className = 'daily-illustration rejected-daily-illustration';
    image.src = illustration.src;
    image.alt = `${illustration.label} — ${illustration.date}`;
    image.loading = 'eager';
    image.decoding = 'async';
    imageCell.appendChild(image);
    imageRow.appendChild(imageCell);
    tbody.appendChild(imageRow);
  }

  const groupList = document.createElement('div');
  groupList.className = 'rejected-balls-groups';
  groupList.style.cssText = 'width:100%;max-width:600px;margin:0 auto;padding:0;box-sizing:border-box;';
  const programmes = Array.isArray(payload.programmes)
    ? payload.programmes.filter((programme) => (
      programme && Array.isArray(programme.groups)
    ))
    : [];
  if (programmes.length) {
    programmes.forEach((programme) => {
      const hour = Number.isFinite(Number(programme.hour))
        ? ` · ${String(programme.hour).padStart(2, '0')}h`
        : '';
      groupList.appendChild(makeCircleRow(
        `${programme.country || 'Pays'}${hour} · ${programme.name || 'Boules rejetées'}`,
        programme.groups,
        color
      ));
    });
  } else {
    groupList.appendChild(makeCircleRow('Ghana', groups.ghana || [], color));
    groupList.appendChild(makeCircleRow("Côte d'Ivoire", groups.coteDIvoire || [], color));
    groupList.appendChild(makeCircleRow('Bénin', groups.benin || [], color));
    groupList.appendChild(makeCircleRow('Niger', groups.niger || [], color));
    groupList.appendChild(makeCircleRow('Sénégal', groups.senegal || [], color));
    groupList.appendChild(makeCircleRow('Togo', groups.togo || [], color));
  }

  const row = document.createElement('tr');
  row.dataset.frame = '1';
  row.dataset.frameTitle = `Boules rejetées — ${dateForDisplay(payload.programmeDate)}`;
  const cell = document.createElement('td');
  cell.className = 'rejected-balls-cell';
  cell.colSpan = 2;
  cell.style.padding = '12px 0';
  cell.appendChild(groupList);
  row.appendChild(cell);
  tbody.appendChild(row);
}

export async function renderRejectedTable(options = {}) {
  const tbody = document.getElementById(options.tbodyId || 'rejectedTableBody');
  if (!tbody) return null;
  const viewToken = rejectedViewToken;

  try {
    const anticipationActive = document.body.classList.contains('anticipation-active')
      || document.body.dataset.cidDedicatedView === 'anticipe'
      || window.__currentCategory === 'anticipe';
    const programmeDate = options.programmeDate
      || (anticipationActive
        ? window.cidEarlyAccessUi?.programmeDateFor?.('boules-rejetees')
        : null)
      || undefined;
    const requestOptions = programmeDate ? { ...options, programmeDate } : options;
    const requestDate = String(programmeDate || '').slice(0, 10);

    /*
     * Anticipé preview: render the already validated server payload with the
     * daily renderer. No network call, no localStorage write: the future
     * publication stays in its own session.
     */
    if (rejectedPreview && (!requestDate || rejectedPreview.date === requestDate)) {
      latestRejectedPayload = rejectedPreview.payload;
      renderPayload(tbody, rejectedPreview.payload);
      tbody.dataset.cidCacheState = 'preview';
      tbody.dataset.cidSignature = rejectedSignature(rejectedPreview.payload);
      syncInlineRejectedView(tbody);
      return rejectedPreview.payload;
    }

    const cachedPayload = readRejectedCache(requestDate);

    /*
     * localStorage first: paint the last validated result synchronously. The
     * request below still runs and remains authoritative, but only repaints
     * when its values actually differ (no flash on identical data).
     */
    if (cachedPayload && viewToken === rejectedViewToken) {
      latestRejectedPayload = cachedPayload;
      renderPayload(tbody, cachedPayload);
      tbody.dataset.cidCacheState = 'stale-while-revalidate';
      tbody.dataset.cidSignature = rejectedSignature(cachedPayload);
      syncInlineRejectedView(tbody);
    } else {
      tbody.innerHTML = `<tr><td colspan="2" style="padding:16px;text-align:center;color:#666;">${escapeHtml(t('rejected.loading', 'Lecture des Boules rejetées…'))}</td></tr>`;
      tbody.dataset.cidSignature = '';
      syncInlineRejectedView(tbody);
    }

    /*
     * A rejected-ball promise is date-bound. Reusing the promise from the
     * current publication here was the source of the archive bug: opening
     * 1 September could repaint the already loaded 19 September payload.
     */
    if (!rejectedRequest || options.force || rejectedRequestDate !== requestDate) {
      rejectedRequestDate = requestDate;
      const identity = rejectedIdentity();
      rejectedRequest = fetchRejectedBalls(requestOptions).then((payload) => {
        if (viewToken === rejectedViewToken) latestRejectedPayload = payload;
        if (identity === rejectedIdentity()) {
          writeRejectedCache(requestDate || payload?.programmeDate, payload);
        }
        return payload;
      });
    }
    const paintFresh = (payload) => {
      const signature = rejectedSignature(payload);
      if (!options.force && tbody.dataset.cidSignature === signature) {
        tbody.dataset.cidCacheState = 'fresh';
        return;
      }
      renderPayload(tbody, payload);
      tbody.dataset.cidCacheState = 'fresh';
      tbody.dataset.cidSignature = signature;
      syncInlineRejectedView(tbody);
    };
    if (cachedPayload) {
      rejectedRequest
        .then((payload) => {
          if (viewToken !== rejectedViewToken) return;
          paintFresh(payload);
        })
        .catch((error) => {
          console.info('Actualisation silencieuse des Boules rejetées impossible.', error);
        });
      return cachedPayload;
    }
    const payload = await rejectedRequest;
    // A request can finish after navigation. Its response must not repaint a
    // detached/hidden rejected surface or recreate a ghost layer.
    if (viewToken !== rejectedViewToken) return null;
    paintFresh(payload);
    return payload;
  } catch (error) {
    if (viewToken !== rejectedViewToken) return null;
    rejectedRequest = null;
    console.warn('Rejected balls loading failed', error);
    renderError(tbody, t('rejected.unavailable', 'Les Boules rejetées sont indisponibles pour le moment.'));
    syncInlineRejectedView(tbody);
    throw error;
  }
}

export function enterRejectedView() {
  rejectedViewToken += 1;
  latestRejectedPayload = null;
}

export function setRejectedPreview(session = null) {
  rejectedPreview = session?.payload && session?.date
    ? { date: String(session.date).slice(0, 10), payload: session.payload }
    : null;
}

export function leaveRejectedView() {
  rejectedViewToken += 1;
  rejectedPreview = null;
  rejectedRequest = null;
  rejectedRequestDate = '';
  latestRejectedPayload = null;
  clearRejectedViewDom();
}

export async function copyAllRejected() {
  try {
    const payload = latestRejectedPayload || await fetchRejectedBalls();
    await navigator.clipboard.writeText(formatRejectedBalls(payload));
    alert(t('rejected.allCopied', 'Toutes les Boules rejetées ont été copiées.'));
  } catch (error) {
    console.error('copyAllRejected failed', error);
    alert(t('rejected.allCopyFailed', 'Impossible de copier les Boules rejetées.'));
  }
}

export function initRejectedController() {
  window.rejectedController = window.rejectedController || {};
  window.renderRejectedTable = renderRejectedTable;
  window.copyAllRejected = copyAllRejected;
  window.rejectedController.enter = enterRejectedView;
  window.rejectedController.leave = leaveRejectedView;
  window.rejectedController.setPreview = setRejectedPreview;
  window.rejectedController.mountInline = mountRejectedInline;
  window.cidMountRejectedInline = mountRejectedInline;
}

document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest('.rejected-copy-btn[data-copy-text]')
    : null;
  if (!button) return;
  const label = button.dataset.copyLabel || button.textContent;
  try {
    await navigator.clipboard.writeText(button.dataset.copyText);
    button.textContent = t('rejected.copied', 'Copié');
    window.setTimeout(() => { button.textContent = label; }, 1200);
  } catch (_) {
    button.textContent = t('rejected.copyFailed', 'Copie impossible');
  }
});

if (document.readyState !== 'loading') {
  initRejectedController();
} else {
  document.addEventListener('DOMContentLoaded', initRejectedController, { once: true });
}

window.addEventListener('cidgroup:illustrations-updated', () => {
  if (document.body.classList.contains('rejected-active')) {
    renderRejectedTable({ force: true }).catch(() => {});
  }
});
window.addEventListener('cid:language-change', () => {
  if (document.body.classList.contains('rejected-active')) {
    renderRejectedTable({ force: true }).catch(() => {});
  }
});
