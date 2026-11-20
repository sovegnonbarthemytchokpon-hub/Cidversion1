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
const REJECTED_CACHE_MAX_AGE = 36 * 60 * 60 * 1000;

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

function readRejectedCache(date) {
  const cache = window.cidComponentRuntime?.cache;
  const stored = cache?.read?.(rejectedCacheKey(date), {
    identity: 'visitor',
    maxAgeMs: REJECTED_CACHE_MAX_AGE
  });
  return stored?.value && typeof stored.value === 'object'
    ? stored.value
    : null;
}

function writeRejectedCache(date, payload) {
  if (!payload || typeof payload !== 'object') return;
  window.cidComponentRuntime?.cache?.write?.(
    rejectedCacheKey(date),
    payload,
    { identity: 'visitor', meta: { programmeDate: rejectedProgrammeDate(date) } }
  );
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
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${title}\n${numbers.join('\n')}\n`);
      copyButton.textContent = t('rejected.copied', 'Copié');
      window.setTimeout(() => {
        copyButton.textContent = ti('rejected.copy', { title }, 'Copier {{title}}');
      }, 1200);
    } catch (_) {
      copyButton.textContent = t('rejected.copyFailed', 'Copie impossible');
    }
  });
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
    const cachedPayload = readRejectedCache(requestDate);

    /*
     * Paint the last validated public result synchronously. The request below
     * still runs and remains authoritative, but a slow Supabase response can
     * no longer turn the whole route into a white/loading rectangle.
     */
    if (cachedPayload && viewToken === rejectedViewToken) {
      renderPayload(tbody, cachedPayload);
      tbody.dataset.cidCacheState = 'stale-while-revalidate';
    } else {
      tbody.innerHTML = `<tr><td colspan="2" style="padding:16px;text-align:center;color:#666;">${escapeHtml(t('rejected.loading', 'Lecture des Boules rejetées…'))}</td></tr>`;
    }

    /*
     * A rejected-ball promise is date-bound. Reusing the promise from the
     * current publication here was the source of the archive bug: opening
     * 1 September could repaint the already loaded 19 September payload.
     */
    if (!rejectedRequest || options.force || rejectedRequestDate !== requestDate) {
      rejectedRequestDate = requestDate;
      rejectedRequest = fetchRejectedBalls(requestOptions).then((payload) => {
        if (viewToken === rejectedViewToken) latestRejectedPayload = payload;
        writeRejectedCache(requestDate || payload?.programmeDate, payload);
        return payload;
      });
    }
    if (cachedPayload) {
      /*
       * A cached paint is the usable result of this call. Continue the
       * authoritative request silently; the next visit will use its fresh
       * value without making this first paint wait on the network.
       */
      rejectedRequest
        .then((payload) => {
          if (viewToken !== rejectedViewToken) return;
          renderPayload(tbody, payload);
          tbody.dataset.cidCacheState = 'fresh';
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
    renderPayload(tbody, payload);
    tbody.dataset.cidCacheState = 'fresh';
    return payload;
  } catch (error) {
    if (viewToken !== rejectedViewToken) return null;
    rejectedRequest = null;
    console.warn('Rejected balls loading failed', error);
    renderError(tbody, t('rejected.unavailable', 'Les Boules rejetées sont indisponibles pour le moment.'));
    throw error;
  }
}

export function enterRejectedView() {
  rejectedViewToken += 1;
  latestRejectedPayload = null;
}

export function leaveRejectedView() {
  rejectedViewToken += 1;
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
}

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
