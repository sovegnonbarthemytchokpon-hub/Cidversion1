/*
 * Croix section presentation.
 *
 * This module only projects already-published Croix records and the same
 * social publication ids used by Accueil. It does not calculate or alter
 * any Croix result.
 */

import {
  CROSS_DAY_STYLES,
  applyCrossDayStyle,
  crossDayStyleForDate,
  fetchCroixProgrammeForDate,
  getCachedCroixGenerations,
  isCroixArchiveCacheFresh
} from '/src/croix/redCrossService.js';
import { getProgrammeDate } from '/src/backend-server/methods/program-clock.js';

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const t = (key, fallback = key) => (
  window.cidTranslation?.t?.(key, fallback) || fallback
);
const ti = (key, values = {}, fallback = key) => Object.entries(values).reduce(
  (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
  t(key, fallback)
);

function getPublicShareUrl() {
  const referralUrl = window.cidReferralSystem?.getShareUrl?.(window.location.href);
  if (referralUrl) return referralUrl;
  try {
    const url = new URL(window.location.href);
    url.protocol = 'https:';
    url.hostname = 'cidmap.com';
    url.port = '';
    return url.toString();
  } catch (_) {
    return 'https://cidmap.com/';
  }
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function uiLocale() {
  return String(
    window.cidTranslation?.current?.()
      || localStorage.getItem('cid_i18n_locale')
      || localStorage.getItem('userLang')
      || 'fr'
  ).replace('_', '-');
}
// The archive needs the current row plus eight previous rows. The home feed
// already warms exactly this range, so opening the dedicated view must reuse
// it instead of asking Supabase for an unnecessarily larger page.
// The current publication plus eight previous days make the nine-day window.
const CROIX_HISTORY_ROWS_NEEDED = 9;
const HISTORY_CROSS_REFERENCE_SIZE = 380;
const historyCrossGeometryObservers = new WeakSet();
let croixHistoryMountEpoch = 0;
let croixHistoryMarkupRetryTimer = 0;
// Dates already requested individually during this session. A date that
// has no published row yet is not requested again on every route opening.
const croixHistoryDateRequests = new Set();

function canonicalCrossSource() {
  return Array.from(document.querySelectorAll('#redCross')).find((element) => (
    element.dataset.cidHistoryClone !== 'true'
      && !element.classList.contains('cid-fb-home-history-cross')
      && !element.classList.contains('cid-croix-history-component')
  )) || null;
}

/*
 * Historical cards reuse the canonical Croix DOM, but they do not belong to
 * the static roots watched by cross-responsive.js. Keep their coordinate
 * plane synchronized with the card that contains them so the date, badge,
 * numbers and footer all shrink together on narrow cards.
 */
function syncHistoryCrossGeometry(root) {
  if (!root) return;
  const width = root.getBoundingClientRect().width;
  if (!Number.isFinite(width) || width <= 0) return;

  const size = `${Math.round(width * 100) / 100}px`;
  const scale = Math.min(1, width / HISTORY_CROSS_REFERENCE_SIZE);
  root.style.setProperty('--cross-scale', String(scale), 'important');
  root.style.setProperty('height', size, 'important');
  root.style.setProperty('min-height', size, 'important');
  root.style.setProperty('max-height', size, 'important');
  root.style.setProperty('aspect-ratio', '1 / 1', 'important');
  root.querySelectorAll('.cross-numbers .num').forEach((number) => {
    number.style.removeProperty('font-size');
    const transform = number.style.getPropertyValue('transform');
    if (transform && transform.includes('px')
        && !transform.includes('--cross-scale')) {
      number.style.setProperty(
        'transform',
        transform.replace(
          /(-?\d+(?:\.\d+)?)px/g,
          'calc($1px * var(--cross-scale, 1))'
        ),
        'important'
      );
    }
  });

  const svg = root.querySelector(':scope > svg');
  if (!svg) return;
  svg.style.setProperty('width', '100%', 'important');
  svg.style.setProperty('height', '100%', 'important');
  svg.style.setProperty('max-width', 'none', 'important');
  svg.style.setProperty('max-height', 'none', 'important');
  svg.style.setProperty('aspect-ratio', '1 / 1', 'important');
}

function observeHistoryCrossGeometry(root) {
  if (!root) return;
  syncHistoryCrossGeometry(root);
  if (historyCrossGeometryObservers.has(root)) return;
  historyCrossGeometryObservers.add(root);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => syncHistoryCrossGeometry(root));
    observer.observe(root);
    return;
  }

  const sync = () => syncHistoryCrossGeometry(root);
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });
}

function isLightCrossColor(color) {
  return String(color || '').trim().toUpperCase() === '#FFD700';
}

function applyCrossControlsTheme(root, color) {
  if (!root || !color) return;
  const style = Object.values(CROSS_DAY_STYLES).find((entry) => (
    String(entry.color).toUpperCase() === String(color).toUpperCase()
  )) || crossDayStyleForDate('');
  const foreground = style.ink;
  const controlInk = isLightCrossColor(color) ? foreground : color;
  applyCrossDayStyle(root, style.day);
  root.style.setProperty('--cid-cross-color', color, 'important');
  root.style.setProperty('--cid-cross-ink', foreground, 'important');
  root.style.setProperty('--redCross-bg', color, 'important');
  root.style.setProperty('background', color, 'important');

  root.querySelectorAll([
    '.cross-numbers .num',
    '#redCrossDate',
    '.term-title',
    '.term-paren',
    '.right-label',
    '.redCrossFooter',
    'svg .cross-line'
  ].join(',')).forEach((element) => {
    [
      'color',
      '-webkit-text-fill-color',
      '-webkit-text-stroke',
      '-webkit-text-stroke-color',
      'text-stroke',
      'text-shadow',
      'fill',
      'stroke'
    ].forEach((property) => element.style.removeProperty(property));
  });

  root.querySelectorAll([
    '.cross-numbers .num',
    '#redCrossDate',
    '.term-title',
    '.term-paren',
    '.right-label',
    '.redCrossFooter'
  ].join(',')).forEach((element) => {
    element.style.setProperty('color', foreground, 'important');
    element.style.setProperty('-webkit-text-fill-color', foreground, 'important');
    element.style.setProperty('-webkit-text-stroke', '0', 'important');
    element.style.setProperty('text-shadow', 'none', 'important');
  });
  root.querySelectorAll('svg .cross-line').forEach((line) => {
    line.style.setProperty('stroke', foreground, 'important');
  });

  root.querySelectorAll('.sunday-button').forEach((button) => {
    button.style.setProperty('background', color, 'important');
    button.style.setProperty('color', foreground, 'important');
    button.style.setProperty('-webkit-text-fill-color', foreground, 'important');
    button.style.setProperty('border-color', foreground, 'important');
  });

  root.querySelectorAll('.black-square-btn').forEach((button) => {
    // Keep the outer action white for contrast while the actual 5/90 disc and
    // its inscription follow the exact colour of the cross.
    button.style.setProperty('background', '#ffffff', 'important');
    button.style.setProperty('color', color, 'important');
    button.style.setProperty('border-color', 'rgba(0,0,0,0.06)', 'important');

    button.querySelectorAll('svg circle').forEach((circle) => {
      circle.style.setProperty('fill', color, 'important');
      circle.style.setProperty('stroke', color, 'important');
    });
    button.querySelectorAll('svg textPath').forEach((textPath) => {
      textPath.style.setProperty('fill', controlInk, 'important');
    });
    button.querySelectorAll('svg text').forEach((text) => {
      const value = (text.textContent || '').trim();
      text.style.setProperty(
        'fill',
        value === '5/90' ? foreground : color,
        'important'
      );
    });
  });

}

// Keep the dedicated Croix publication header pixel-identical to the
// publication header rendered on Accueil.
const VERIFIED_BADGE = `
  <svg class="cid-fb-verified" viewBox="0 0 24 24" width="18" height="18"
       role="img" aria-label="Page vérifiée" focusable="false">
    <title>Page vérifiée</title>
    <g transform="translate(12 12) scale(1.65) translate(-17 -12.5)">
      <path d="M22.5 12.5c0-.8-.5-1.5-1.1-1.9.3-.8.2-1.8-.4-2.4-.6-.6-1.6-.7-2.4-.4-.4-.6-1.1-1.1-1.9-1.1s-1.5.5-1.9 1.1c-.8-.3-1.8-.2-2.4.4-.6.6-.7 1.6-.4 2.4-.6.4-1.1 1.1-1.1 1.9s.5 1.5 1.1 1.9c-.3.8-.2 1.8.4 2.4.6.6 1.6.7 2.4.4.4.6 1.1 1.1 1.9 1.1s1.5-.5 1.9-1.1c.8.3 1.8-.2 2.4-.4-.3-.8-.2-1.8.4-2.4.6-.6.7-1.6.4-2.4z" fill="#1877F2"/>
    </g>
    <path d="M12 1.8 14.2 3l2.5-.3 1.2 2.2 2.2 1.2-.3 2.5 1.2 2.2-1.2 2.2.3 2.5-2.2 1.2-1.2 2.2-2.5-.3-2.2 1.2-2.2-1.2-2.5.3-1.2-2.2-2.2-1.2.3-2.5-1.2-2.2 1.2-2.2-.3-2.5 2.2-1.2L9.8 3z" fill="#1877F2"/>
    <path d="M7.4 12.1l3.2 3.2 6.1-6.1" fill="none" stroke="#fff"
          stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

function programmeDate() {
  return window.cidDailyIllustrations?.getProgrammeDate?.() || getProgrammeDate();
}

function isoDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? String(value || '')
    : date.toLocaleDateString(uiLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    });
}

function configuredCommentsEnabled(postId, type = 'cross') {
  if (typeof window.cidContentControl?.commentsEnabled !== 'function') return false;
  return window.cidContentControl.commentsEnabled(postId, type) === true;
}

function applyCroixCommentsVisibility(post, enabled) {
  if (!post) return;
  const commentsEnabled = enabled === true;
  post.dataset.commentsEnabled = String(commentsEnabled);
  post.classList.toggle('is-comments-off', !commentsEnabled);

  const summary = $('[data-croix-comment-view]', post);
  const separator = $('[data-croix-comments-separator]', post);
  const commentAction = $('[data-croix-comment-toggle]', post);
  const panel = $('.cid-croix-comment-panel, .cid-croix-history-comments', post);
  if (summary) summary.hidden = !commentsEnabled;
  if (separator) separator.hidden = !commentsEnabled;
  if (commentAction) commentAction.hidden = !commentsEnabled;
  if (panel && !commentsEnabled) panel.hidden = true;
  if (!commentsEnabled) post.dataset.commentsOpen = 'false';
}

async function resolveCroixCommentsEnabled(post) {
  if (!post) return false;
  const postId = post.dataset.croixPostId || '';
  if (!configuredCommentsEnabled(postId, 'cross')) {
    applyCroixCommentsVisibility(post, false);
    return false;
  }

  let enabled = false;
  try {
    enabled = await window.cidSocialRepository?.getPublicationCommentsEnabled?.(postId);
  } catch (_) {}
  enabled = enabled === true;
  post.__cidCommentsEnabled = enabled;
  applyCroixCommentsVisibility(post, enabled);
  return enabled;
}

function assignmentOf(row) {
  return Array.isArray(row?.assignment) ? row.assignment.map(String).slice(0, 8) : [];
}

function historyRowFromLiveRecord(record, fallbackDate) {
  const programmeDate = String(
    record?.programmeDate || record?.programme_date || fallbackDate || ''
  ).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(programmeDate)) return null;
  return {
    id: record?.id || null,
    programme_date: programmeDate,
    assignment: Array.isArray(record?.assignment)
      ? record.assignment.map(String).slice(0, 8)
      : Array.isArray(record?.crossNumbers)
        ? record.crossNumbers.map(String).slice(0, 8)
        : [],
    term: String(record?.term || ''),
    visible_terminaison: String(
      record?.terminaison || record?.visible_terminaison || ''
    ),
    generated_year: Number(record?.year || record?.generated_year) || 0,
    generated_month: Number(record?.month || record?.generated_month) || 0,
    scope_key: String(record?.scope || record?.scope_key || ''),
    alignments: record?.alignments || record?.crossLineGroups || {},
    signature: String(record?.signature || ''),
    created_at: record?.createdAt || record?.created_at || null
  };
}

/*
 * localStorage first: the nine published rows already stored on the device
 * (by Accueil, a previous visit or the live Croix) are read synchronously so
 * the dedicated route paints its complete carousel in the first frame,
 * including offline. Nothing is calculated here: rows are the stored
 * back-end records.
 */
function cachedHistoryRows() {
  try {
    return getCachedCroixGenerations(CROIX_HISTORY_ROWS_NEEDED) || [];
  } catch (_) {
    return [];
  }
}

function mergeHistoryRows(...lists) {
  const byDate = new Map();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((row) => {
      const date = String(row?.programme_date || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) byDate.set(date, row);
    });
  });
  return Array.from(byDate.values());
}

/*
 * After the single batch read, only dates that are still absent (normally a
 * publication that was not listed yet) are read individually, once per
 * session. The adapter is itself localStorage-first and stores the result.
 */
async function fillMissingHistoryRows(rows) {
  if (navigator.onLine === false) return rows;
  const missing = historyWindowRows(rows)
    .filter((row) => row.placeholder && !croixHistoryDateRequests.has(row.programme_date));
  if (!missing.length) return rows;
  missing.forEach((row) => croixHistoryDateRequests.add(row.programme_date));
  const liveRows = await Promise.allSettled(
    missing.map(async (row) => {
      const record = await fetchCroixProgrammeForDate(row.programme_date);
      return historyRowFromLiveRecord(record, row.programme_date);
    })
  );
  return mergeHistoryRows(
    rows,
    liveRows
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value)
  );
}

function historyCard(row, historyDay = 0) {
  return window.cidFacebookFeed?.historicalCrossPostMarkup?.(row, historyDay) || '';
}

function historyWindowRows(rows) {
  const current = programmeDate();
  const currentIso = isoDate(current);
  const byDate = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.programme_date || '')))
      .map((row) => [String(row.programme_date), row])
  );
  // The dedicated view is a single nine-day carousel. Keep today as the
  // first item, followed by yesterday through eight days ago, so every card
  // uses the exact same renderer and the track never needs a second "current"
  // layout above it.
  return Array.from({ length: 9 }, (_, index) => {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() - index);
    const programme_date = isoDate(date);
    return byDate.get(programme_date) || {
      programme_date,
      assignment: [],
      term: '0',
      visible_terminaison: '0',
      placeholder: true
    };
  }).filter((row) => row.programme_date && row.programme_date !== '' && (
    row.programme_date === currentIso || row.programme_date < currentIso
  ));
}

function updateHistoryCard(card, row) {
  if (!card || !row) return;
  const postId = `cross:${row.programme_date}`;
  const date = new Date(`${row.programme_date}T12:00:00.000Z`);
  const day = Number.isNaN(date.getTime()) ? '' : DAY_NAMES[date.getUTCDay()];
  $('.cid-croix-history-date strong', card).textContent = formatDate(row.programme_date);
  $('.cid-croix-history-date small', card).textContent = day;
  card.dataset.croixPostId = postId;
  const isCurrent = row.programme_date === isoDate(programmeDate());
  card.classList.toggle('is-current', isCurrent);
  card.dataset.croixDayIndex = isCurrent ? '0' : '';
  const commentsEnabled = configuredCommentsEnabled(postId, 'cross');
  card.dataset.commentsEnabled = String(commentsEnabled);
  card.classList.toggle('is-comments-off', !commentsEnabled);
  applyCroixCommentsVisibility(card, commentsEnabled);
  $('[data-croix-like-count]', card).textContent = '0';
  $('[data-croix-share-count]', card).textContent = '0';
  $('[data-croix-like]', card).setAttribute('aria-pressed', 'false');
  $('[data-croix-like]', card).classList.remove('is-liked');
  const slot = $('.cid-croix-history-cross-slot', card);
  if (!slot) return;
  const assignment = assignmentOf(row);
  slot.dataset.historyCrossDate = String(row.programme_date);
  slot.dataset.historyCrossAssignment = JSON.stringify(assignment);
  slot.dataset.historyCrossTerm = String(row.term || '0');
  slot.dataset.historyCrossTermination = String(row.visible_terminaison || '0');
  const color = crossDayStyleForDate(date).color;
  slot.style.setProperty('--cid-history-cross-color', color);
  updateHistoricalCrossClone(slot, row, color);
}

function updateHistoricalCrossClone(slot, row, color) {
  const clone = slot?.querySelector('.cid-croix-history-component');
  if (!clone) return;
  const assignment = assignmentOf(row);
  const selectedDate = slot.dataset.historyCrossDate || '';
  window.cidDailyIllustrations?.applyCrossIllustration?.(
    clone,
    selectedDate
  );
  const dateElement = clone.querySelector('#redCrossDate');
  if (dateElement) dateElement.textContent = formatDate(selectedDate);
  clone.querySelectorAll('.cross-numbers .num').forEach((number, index) => {
    number.textContent = assignment[index] || '0';
  });
  const termTitle = clone.querySelector('.term-title');
  const termParen = clone.querySelector('.term-paren');
  if (termTitle) termTitle.textContent = `Terminaison ${row?.visible_terminaison || '0'}`;
  if (termParen) termParen.textContent = row?.term || '0';
  clone.style.setProperty('--redCross-bg', color, 'important');
  clone.style.setProperty('--cid-history-cross-color', color, 'important');
  clone.style.setProperty('background', color, 'important');
  applyCrossControlsTheme(clone, color);
}

function mountHistoricalCrosses(track) {
  const source = canonicalCrossSource();
  if (!source || !track) return;
  const previousScrollLeft = track.scrollLeft;
  track.querySelectorAll('.cid-croix-history-cross-slot').forEach((slot) => {
    let assignment = [];
    try {
      assignment = JSON.parse(slot.dataset.historyCrossAssignment || '[]')
        .map(String)
        .slice(0, 8);
    } catch (_) {}
    const date = new Date(`${slot.dataset.historyCrossDate}T12:00:00.000Z`);
    const color = crossDayStyleForDate(
      Number.isNaN(date.getTime()) ? '' : date
    ).color;
    slot.style.setProperty('--cid-history-cross-color', color);
    const existing = slot.querySelector('.cid-croix-history-component');
    const clone = existing || source.cloneNode(true);

    // Reuse the official Croix DOM/CSS coordinate plane. This is a visual
    // clone only; it never registers handlers and never recalculates values.
    if (!existing) {
      clone.id = 'redCross';
      clone.classList.add('cid-croix-history-component');
      clone.dataset.crossReady = 'true';
      clone.dataset.cidHistoryClone = 'true';
      clone.setAttribute('aria-hidden', 'true');
      clone.style.display = 'flex';
      clone.style.pointerEvents = 'none';
      clone.style.margin = '0 auto';
      /*
       * The live source is observed by cross-responsive.js and therefore
       * carries inline width/height values. A historical clone lives inside
       * a narrower card, so those values must not leak into it.
       */
      [
        'width',
        'height',
        'min-width',
        'min-height',
        'max-width',
        'max-height',
        'aspect-ratio'
      ].forEach((property) => clone.style.removeProperty(property));
      clone.querySelector('#crossDatePicker')?.remove();
      clone.querySelector('#openCrossDateBtn')?.remove();
      clone.querySelector('#redCrossCopyImageBtn')?.remove();
      clone.querySelectorAll('[id$="-clone"]').forEach((element) => {
        if (element !== clone) element.removeAttribute('id');
      });
      slot.appendChild(clone);
    }
    observeHistoryCrossGeometry(clone);
    updateHistoricalCrossClone(slot, {
      assignment,
      term: slot.dataset.historyCrossTerm,
      visible_terminaison: slot.dataset.historyCrossTermination
    }, color);
  });
  if (Number.isFinite(previousScrollLeft)) {
    track.scrollLeft = previousScrollLeft;
  }
}

// The home feed reuses the same official historical Croix DOM for its
// nine-day archive. Keeping this bridge here prevents the dedicated section
// and Accueil from drifting into two different cross renderers.
window.cidMountCroixHistoryMedia = mountHistoricalCrosses;

function currentMarkup() {
  const selectedDate = String(
    window.__cidActiveProgrammeDate
      || window.cidProgrammeState?.selectedDate
      || ''
  ).slice(0, 10);
  const selectedLabel = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? ti('croix.selectedTitle', { date: formatDate(selectedDate) }, 'Croix nationale du {{date}}')
    : t('croix.todayTitle', 'Croix nationale du jour');
  return `
    <section id="cid-croix-section" aria-label="${escapeHtml(t('croix.sectionLabel', 'Croix nationale et historique'))}">
      <section class="cid-croix-selected-publication" aria-label="${escapeHtml(`${t('croix.official', 'Publication officielle')} ${t('croix.title', 'Croix nationale')}`)}">
        <div class="cid-croix-section-heading">
          <p class="cid-croix-eyebrow">${escapeHtml(t('croix.official', 'Publication officielle'))}</p>
          <h1>${escapeHtml(t('croix.title', 'Croix nationale'))}</h1>
          <p data-croix-selected-date-label>${escapeHtml(selectedLabel)}</p>
        </div>
        <div id="croixViewCurrentCross" class="cid-croix-current-cross"></div>
      </section>
      <section class="cid-croix-history-section" aria-label="${escapeHtml(t('croix.historyLabel', 'Croix des neuf derniers jours'))}">
        <div class="cid-croix-history-track" data-croix-history-track tabindex="0">
          <p class="cid-croix-history-loading">${escapeHtml(t('croix.historyLoading', 'Chargement des neuf derniers jours…'))}</p>
        </div>
      </section>
    </section>
  `;
  /*
   * Kept below temporarily as a source reference while the dedicated route
   * settles on the shared nine-day card renderer.
   */
  const currentPostId = `cross:${isoDate(date)}`;
  const commentsEnabled = configuredCommentsEnabled(currentPostId, 'cross');
  const fullDate = date.toLocaleDateString(uiLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return `
    <section id="cid-croix-section" aria-label="Croix nationale et historique">
      <header class="cid-croix-section-heading">
        <h1>Croix nationale</h1>
      </header>
      <article class="cid-fb-post cid-croix-current-card${commentsEnabled ? '' : ' is-comments-off'}" data-croix-post-id="${escapeHtml(currentPostId)}" data-comments-open="false" data-comments-enabled="${commentsEnabled}">
        <header class="cid-fb-post-header">
          <div class="cid-fb-avatar">
          <img data-cid-brand-avatar src="${window.__cidBrandAvatarSrc || '/src/shared/images/squirrel-croix-192.png'}" alt="Photo de profil Cidmap">
          </div>
          <div class="cid-fb-author">
            <div class="cid-fb-author-line">
              <span class="cid-fb-page-name">Cidmap</span>
              ${VERIFIED_BADGE}
              <!--
                <path d="M22.5 12.5c0-.8-.5-1.5-1.1-1.9.3-.8.2-1.8-.4-2.4-.6-.6-1.6-.7-2.4-.4-.4-.6-1.1-1.1-1.9-1.1s-1.5.5-1.9 1.1c-.8-.3-1.8-.2-2.4.4-.6.6-.7 1.6-.4 2.4-.6.4-1.1 1.1-1.1 1.9s.5 1.5 1.1 1.9c-.3.8-.2 1.8.4 2.4.6.6 1.6.7 2.4.4.4.6 1.1 1.1 1.9 1.1s1.5-.5 1.9-1.1c.8.3 1.8.2 2.4-.4.6-.6.7-1.6.4-2.4.6-.4 1.1-1.1 1.9-1.1s1.5.5 1.9 1.1c.6-.4 1.1-1.1 1.1-1.9Z" fill="#1877F2"/>
              -->
            </div>
            <div class="cid-fb-time">Publication officielle · 🌐</div>
          </div>
        </header>
        <div class="cid-fb-post-copy">
          <p><strong>Croix nationale pour le divertissement 💯 de ce ${escapeHtml(fullDate)}</strong></p>
        </div>
        <div class="cid-fb-media cid-fb-cross-media">
          <div id="croixViewCurrentCross" class="cid-fb-cross-slot"></div>
        </div>
        <div class="cid-fb-summary">
          <span class="cid-fb-reactions">
            <span class="cid-fb-reaction-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="M7.5 10.5v10h-3a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5h3Zm2 10v-10l3.2-6.3a1.8 1.8 0 0 1 3.3.8v4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.8a2.7 2.7 0 0 1-2.6 2.1H9.5Z"/></svg>
            </span>
            <b data-croix-like-count>0</b>
          </span>
        <span>
          <button type="button" class="cid-croix-comment-count-toggle" data-croix-comment-view${commentsEnabled ? '' : ' hidden'}>
            <b data-croix-comment-count>0</b> commentaire<span class="cid-croix-comment-count-plural">s</span>
          </button>
          <span data-croix-comments-separator aria-hidden="true"${commentsEnabled ? '' : ' hidden'}>·</span>
          <b data-croix-share-count>0</b> partages
        </span>
        </div>
        <div class="cid-fb-comments cid-croix-comment-panel" hidden>
          <div class="cid-fb-comment-list cid-croix-comment-list" aria-live="polite"></div>
          <form class="cid-fb-comment-form cid-croix-comment-form">
            <textarea class="cid-fb-comment-input" rows="1" placeholder="Écrire un commentaire…" aria-label="Écrire un commentaire"></textarea>
            <button class="cid-fb-comment-submit" type="submit">Publier</button>
          </form>
        </div>
        <footer class="cid-fb-actions">
          <button type="button" class="cid-fb-action cid-croix-action" data-croix-like aria-pressed="false">
            <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 10.5v10h-3a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5h3Zm2 10v-10l3.2-6.3a1.8 1.8 0 0 1 3.3.8v4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.8a2.7 2.7 0 0 1-2.6 2.1H9.5Z"/></svg>
            <span class="cid-fb-action-label">J’aime</span>
            <span class="cid-fb-action-count cid-fb-like-action-count">0</span>
          </button>
          <button type="button" class="cid-fb-action cid-croix-action" data-croix-comment-toggle${commentsEnabled ? '' : ' hidden'}>
            <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 11.5a8 8 0 0 1-8 8H8l-4.5 2 1.3-3.9a8 8 0 1 1 15.7-6.1ZM8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg>
            <span>Commenter</span>
          </button>
          <button type="button" class="cid-fb-action cid-croix-action" data-croix-share>
            <svg class="cid-fb-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5 6 7-6 7v-4.2C8.5 14.8 5 17 3 20c.5-5.7 3.3-9.3 11-10.8V5Z"/></svg>
            <span class="cid-fb-action-label">Partager</span>
            <span class="cid-fb-action-count cid-fb-share-action-count">0</span>
          </button>
        </footer>
        <p class="cid-croix-status cid-fb-status" role="status" aria-live="polite"></p>
      </article>
      <section class="cid-croix-history-section" aria-label="Croix des neuf derniers jours">
        <div class="cid-croix-history-heading">
          <h2>Les 7 dernières Croix</h2>
          <span>Défilement horizontal automatique</span>
        </div>
        <div class="cid-croix-history-track" data-croix-history-track tabindex="0">
          <p class="cid-croix-history-loading">Chargement de l’historique…</p>
        </div>
      </section>
    </section>
  `;
}

function setStatus(text) {
  const element = $('.cid-croix-status');
  if (element) element.textContent = text;
}

function openSharedComments(post, mode) {
  const flow = window.cidCommentsFlows?.[mode];
  if (typeof flow !== 'function') return false;
  flow(post);
  return true;
}

async function requireCroixAccount(action) {
  if (typeof window.cidSocialAuthGate?.requireAccount === 'function') {
    return window.cidSocialAuthGate.requireAccount(action);
  }
  const bridge = await Promise.resolve(window.cidSupabaseReady).catch(() => null);
  const user = await Promise.resolve(bridge?.getUser?.()).catch(() => null);
  if (user?.id) return user;
  const open = window.showProfileView || window.openInlineAuthPanel;
  if (typeof open === 'function') await Promise.resolve(open()).catch(() => {});
  return null;
}

async function openCroixWriter(post) {
  if (post?.dataset?.commentsEnabled !== 'true') return;
  const user = await requireCroixAccount('commenter');
  if (!user) return;
  openSharedComments(post, 'writeCommentMode');
}

async function updateSocial(post, { includeComments = true } = {}) {
  const repo = window.cidSocialRepository;
  if (!repo || !post) return;
  const postId = post.dataset.croixPostId;
  try {
    const metrics = await repo.getPostMetrics(postId);
    const likes = $('[data-croix-like-count]', post);
    const shares = $('[data-croix-share-count]', post);
    const likeActionCount = $('.cid-fb-like-action-count', post);
    const shareActionCount = $('.cid-fb-share-action-count', post);
    if (likes) likes.textContent = String(metrics.likes || 0);
    if (shares) shares.textContent = String(metrics.shares || 0);
    if (likeActionCount) likeActionCount.textContent = String(metrics.likes || 0);
    if (shareActionCount) shareActionCount.textContent = String(metrics.shares || 0);
    const likeButton = $('[data-croix-like]', post);
    if (likeButton) {
      likeButton.setAttribute('aria-pressed', String(Boolean(metrics.liked)));
      likeButton.classList.toggle('is-liked', Boolean(metrics.liked));
    }
  } catch (_) {}
  if (!includeComments || post.dataset.commentsEnabled !== 'true') return;
  try {
    const comments = await repo.listComments(postId);
    const count = $('[data-croix-comment-count]', post);
    const plural = $('.cid-croix-comment-count-plural', post);
    if (count) count.textContent = String(comments.length);
    if (plural) plural.textContent = comments.length === 1 ? '' : 's';
    const list = $('.cid-croix-comment-list', post);
    if (list) {
      list.innerHTML = comments.map((comment) => `
        <div class="cid-croix-comment">
          <strong>Membre Cidmap</strong>
          <span>${escapeHtml(comment.comment_text)}</span>
        </div>
      `).join('');
    }
  } catch (_) {}
}

function wireHistoryActions(track) {
  track.querySelectorAll('.cid-croix-history-card').forEach((card) => {
    if (card.dataset.actionsWired === 'true') return;
    card.dataset.actionsWired = 'true';

    $('[data-croix-like]', card)?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const postId = card.dataset.croixPostId;
      const user = await requireCroixAccount('aimer cette publication');
      if (!user) return;
      try {
        const liked = await window.cidSocialRepository?.togglePostLike?.(postId);
        if (liked) window.cidPlayLikeSound?.();
        button.setAttribute('aria-pressed', String(Boolean(liked)));
        button.classList.toggle('is-liked', Boolean(liked));
        await updateSocial(card, { includeComments: false });
      } catch (_) {}
    });

    $('[data-croix-comment-toggle]', card)?.addEventListener('click', async () => {
      if (card.dataset.commentsEnabled !== 'true') return;
      if (window.cidCommentsFlows?.writeCommentMode) {
        await openCroixWriter(card);
        return;
      }
      const user = await requireCroixAccount('commenter');
      if (!user) return;
      const panel = $('.cid-croix-history-comments', card);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await updateSocial(card);
    });
    $('[data-croix-comment-view]', card)?.addEventListener('click', () => {
      if (card.dataset.commentsEnabled !== 'true') return;
      if (openSharedComments(card, 'viewCommentsMode')) return;
      const panel = $('.cid-croix-history-comments', card);
      if (!panel) return;
      panel.hidden = false;
      updateSocial(card);
    });

    $('[data-croix-share]', card)?.addEventListener('click', async () => {
      const text = `Croix nationale du ${card.querySelector('.cid-croix-history-date strong')?.textContent || ''}`;
      const shareUrl = getPublicShareUrl();
      const postId = card.dataset.croixPostId;
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: 'Croix nationale', text, url: shareUrl });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
        }
        await window.cidSocialRepository?.recordPostShare?.(postId, 'archive');
        await updateSocial(card, { includeComments: false });
      } catch (_) {}
    });
  });
}

function historyStructureKey(history) {
  return `${uiLocale()}::${history.map((row) => row.programme_date).join(',')}`;
}

function historyValueSignature(history) {
  return history.map((row) => [
    row.programme_date,
    assignmentOf(row).join(','),
    row.term || '',
    row.visible_terminaison || ''
  ].join('|')).join('||');
}

// Rows currently painted in the carousel (placeholders excluded), so a later
// local read can only add values, never blank a card already filled.
function paintedHistoryRows(track) {
  return Array.isArray(track?.__cidHistoryRows) ? track.__cidHistoryRows : [];
}

function historyPosts(track) {
  return Array.from(track.children).filter((element) => (
    element.matches('.cid-fb-post[data-post-type="cross"]')
  ));
}

async function renderHistory(rows) {
  const track = $('[data-croix-history-track]');
  if (!track) return;
  const history = historyWindowRows(mergeHistoryRows(paintedHistoryRows(track), rows));
  track.__cidHistoryRows = history.filter((row) => !row.placeholder);
  const structure = historyStructureKey(history);
  const signature = historyValueSignature(history);
  const posts = historyPosts(track);

  /*
   * Same nine dates already on screen: repaint only the published values
   * inside the existing cards. The cards, their Croix clones and the scroll
   * position stay untouched, so a later data arrival never blinks, rebuilds
   * or moves the carousel under the visitor's finger.
   */
  if (track.dataset.historyStructure === structure && posts.length === history.length) {
    if (track.dataset.historySignature === signature) return;
    const scrollLeft = track.scrollLeft;
    track.dataset.historySignature = signature;
    posts.forEach((post, index) => {
      window.cidFacebookFeed?.mountHistoricalCrossPost?.(post, history[index]);
    });
    if (track.scrollLeft !== scrollLeft) track.scrollLeft = scrollLeft;
    return;
  }

  const previousScrollLeft = track.scrollLeft;
  const markup = history
    .map((row, index) => historyCard(row, index))
    .filter(Boolean)
    .join('');
  /*
   * A module race must never turn a populated rail into a blank one. Keep
   * any current cards in place and leave the loading state visible until the
   * shared Facebook renderer is ready.
   */
  if (!markup) {
    if (!posts.length) {
      track.innerHTML = `<p class="cid-croix-history-loading">${escapeHtml(t(
        'croix.historyLoadingShort',
        'Chargement de l’historique…'
      ))}</p>`;
    }
    if (!croixHistoryMarkupRetryTimer) {
      croixHistoryMarkupRetryTimer = window.setTimeout(() => {
        croixHistoryMarkupRetryTimer = 0;
        if (track.isConnected) renderHistory(rows).catch(() => {});
      }, 120);
    }
    return;
  }
  if (croixHistoryMarkupRetryTimer) {
    window.clearTimeout(croixHistoryMarkupRetryTimer);
    croixHistoryMarkupRetryTimer = 0;
  }
  track.__cidHistoryScrollerCleanup?.();
  track.__cidHistoryScrollerCleanup = null;
  track.dataset.historyStructure = structure;
  track.dataset.historySignature = signature;
  track.innerHTML = markup;
  historyPosts(track).forEach((post, index) => {
    const row = history[index];
    window.cidFacebookFeed?.mountHistoricalCrossPost?.(post, row);
    post.dataset.croixPostId = post.dataset.postId || `cross:${row?.programme_date || ''}`;
  });
  track.scrollLeft = previousScrollLeft;
  if (!track.dataset.cidFeedWired) {
    window.cidFacebookFeed?.wireFeed?.(track);
    track.dataset.cidFeedWired = 'true';
  }
  setupHistoryScroller(track);
  // Social counters are read once per built card set, not on every value
  // repaint.
  await Promise.all(historyPosts(track)
    .map((post) => window.cidFacebookFeed?.hydratePost?.(post)));
}

async function loadHistory(initialRows = []) {
  const track = $('[data-croix-history-track]');
  const repo = window.cidSocialRepository;
  if (!track) return;
  const mountEpoch = croixHistoryMountEpoch;
  const stillMounted = () => mountEpoch === croixHistoryMountEpoch && track.isConnected;
  let rows = initialRows;
  let windowComplete = false;
  try {
    windowComplete = isCroixArchiveCacheFresh(CROIX_HISTORY_ROWS_NEEDED)
      && !historyWindowRows(rows).some((row) => row.placeholder);
  } catch (_) {}

  // The local nine-day window is complete: nothing is requested.
  if (windowComplete) return;

  // Otherwise one single batch read fetches the nine rows and stores them in
  // localStorage (offline: the local archive simply stays on screen).
  if (navigator.onLine !== false && repo?.listCroixGenerations) {
    try {
      const fetched = await repo.listCroixGenerations(
        CROIX_HISTORY_ROWS_NEEDED,
        { forceRefresh: true }
      );
      rows = mergeHistoryRows(rows, fetched);
    } catch (error) {
      track.dataset.historyError = 'true';
      console.info('Liste historique Croix indisponible, archive locale conservée.', error);
    }
  }
  if (!stillMounted()) return;
  await renderHistory(rows);
  if (!stillMounted()) return;
  try {
    const completedRows = await fillMissingHistoryRows(rows);
    if (!stillMounted() || completedRows === rows) return;
    await renderHistory(completedRows);
  } catch (error) {
    // A transient data outage must not replace the already-painted archive.
    track.dataset.historyRealtimeError = 'true';
    console.info('Actualisation de l’historique indisponible.', error);
  }
}

function setupHistoryScroller(track) {
  if (!track) return;
  /*
   * The archive is deliberately user-controlled. Autoplay used to call
   * scrollTo({ behavior: "smooth" }) every 4.8 seconds, which moved the
   * published tables while someone was reading or taking a screenshot.
   * Keep a cleanup hook for callers that remount the route, but never move
   * the visitor's scroll position in the background.
   */
  track.__cidHistoryScrollerCleanup = () => {
    track.__cidHistoryScrollerCleanup = null;
  };
}

function focusRequestedHistoryDate(track) {
  const requestedDate = String(window.__cidRequestedCroixArchiveDate || '').slice(0, 10);
  if (!track || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return;
  const card = track.querySelector(
    `.cid-fb-post[data-post-type="cross"][data-programme-date="${requestedDate}"]`
  );
  if (!card) return;
  const paddingLeft = parseFloat(getComputedStyle(track).paddingLeft) || 0;
  track.scrollTo({
    left: Math.max(0, card.offsetLeft - paddingLeft),
    behavior: 'auto'
  });
  card.classList.add('is-requested-date');
  window.setTimeout(() => card.classList.remove('is-requested-date'), 1800);
  window.__cidRequestedCroixArchiveDate = '';
}

function wireCurrent() {
  const section = $('#cid-croix-section');
  const current = $('.cid-croix-current-card', section);
  if (!section || !current || section.dataset.wired === 'true') return;
  section.dataset.wired = 'true';
  resolveCroixCommentsEnabled(current).then((enabled) => (
    updateSocial(current, { includeComments: enabled })
  ));
  $('[data-croix-comment-view]', current)?.addEventListener('click', () => {
    if (current.dataset.commentsEnabled !== 'true') return;
    if (openSharedComments(current, 'viewCommentsMode')) return;
    const panel = $('.cid-croix-comment-panel', current);
    if (!panel) return;
    panel.hidden = false;
    current.dataset.commentsOpen = 'true';
    updateSocial(current);
  });
  $('[data-croix-comment-toggle]', current)?.addEventListener('click', () => {
    if (current.dataset.commentsEnabled !== 'true') return;
    if (window.cidCommentsFlows?.writeCommentMode) {
      openCroixWriter(current);
      return;
    }
    requireCroixAccount('commenter').then((user) => {
      if (!user) return;
      const panel = $('.cid-croix-comment-panel', current);
      if (!panel) return;
      panel.hidden = false;
      current.dataset.commentsOpen = 'true';
      $('textarea', panel)?.focus({ preventScroll: true });
    });
  });
  $('[data-croix-like]', current)?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const user = await requireCroixAccount('aimer cette publication');
    if (!user) return;
    try {
      const liked = await window.cidSocialRepository?.togglePostLike?.(current.dataset.croixPostId);
      if (liked) window.cidPlayLikeSound?.();
      button.setAttribute('aria-pressed', String(Boolean(liked)));
      button.classList.toggle('is-liked', Boolean(liked));
      await updateSocial(current, { includeComments: false });
    } catch (error) {
      setStatus(error?.message || 'Connectez-vous pour aimer cette publication.');
    }
  });
  $('[data-croix-share]', current)?.addEventListener('click', async () => {
    const postId = current.dataset.croixPostId;
    const text = 'Croix nationale pour le divertissement sur Cidmap';
    const shareUrl = getPublicShareUrl();
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Croix nationale', text, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      }
      await window.cidSocialRepository?.recordPostShare?.(postId, 'croix');
      await updateSocial(current, { includeComments: false });
    } catch (_) {}
  });
  $('.cid-croix-comment-form', current)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (current.dataset.commentsEnabled !== 'true') return;
    const input = $('textarea', event.currentTarget);
    const text = String(input?.value || '').trim();
    if (!text) return;
    try {
      await window.cidSocialRepository?.createComment?.({
        drawId: current.dataset.croixPostId,
        text
      });
      input.value = '';
      setStatus('Commentaire publié.');
      await updateSocial(current);
    } catch (error) {
      setStatus(error?.message || 'Impossible de publier le commentaire.');
    }
  });
}

function refreshMountedComments() {
  const section = $('#cid-croix-section');
  if (!section) return;
  const posts = Array.from(section.querySelectorAll(
    '.cid-fb-post[data-post-type="cross"]'
  ));
  Promise.all(posts.map((post) => window.cidFacebookFeed?.hydratePost?.(post)))
    .catch(() => {});
}

function selectedDateLabel() {
  const selectedDate = String(
    window.__cidActiveProgrammeDate
      || window.cidProgrammeState?.selectedDate
      || ''
  ).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? ti('croix.selectedTitle', { date: formatDate(selectedDate) }, 'Croix nationale du {{date}}')
    : t('croix.todayTitle', 'Croix nationale du jour');
}

// Refresh the header text of an already mounted section without touching
// the Croix node or the carousel cards.
function updateSectionLabels(section) {
  section.setAttribute('aria-label', t('croix.sectionLabel', 'Croix nationale et historique'));
  const publication = $('.cid-croix-selected-publication', section);
  publication?.setAttribute(
    'aria-label',
    `${t('croix.official', 'Publication officielle')} ${t('croix.title', 'Croix nationale')}`
  );
  const eyebrow = $('.cid-croix-eyebrow', section);
  if (eyebrow) eyebrow.textContent = t('croix.official', 'Publication officielle');
  const title = $('.cid-croix-section-heading h1', section);
  if (title) title.textContent = t('croix.title', 'Croix nationale');
  const dateLabel = $('[data-croix-selected-date-label]', section);
  if (dateLabel) dateLabel.textContent = selectedDateLabel();
  $('.cid-croix-history-section', section)?.setAttribute(
    'aria-label',
    t('croix.historyLabel', 'Croix des neuf derniers jours')
  );
}

/*
 * Keep the canonical Croix node alive if the section must be rebuilt: an
 * innerHTML replacement would otherwise destroy it together with its
 * already painted official values.
 */
function preserveCanonicalCross(mountPoint) {
  const source = canonicalCrossSource();
  if (!source || !mountPoint.contains(source)) return;
  const container = document.getElementById('croixViewContainer') || document.body;
  container.appendChild(source);
}

function mount() {
  const mountPoint = document.getElementById('croixViewMount');
  if (!mountPoint) return;
  croixHistoryMountEpoch += 1;
  if (croixHistoryMarkupRetryTimer) {
    window.clearTimeout(croixHistoryMarkupRetryTimer);
    croixHistoryMarkupRetryTimer = 0;
  }
  const section = $('#cid-croix-section', mountPoint);
  if (section) {
    // Re-opening the route (Voir plus / Historique, back navigation,
    // language change) reuses the mounted section: no blank frame.
    updateSectionLabels(section);
  } else {
    preserveCanonicalCross(mountPoint);
    mountPoint.innerHTML = currentMarkup();
  }
  // Paint the nine cards from localStorage in this same frame. Later data
  // only repaints values inside these cards.
  const cachedRows = cachedHistoryRows();
  renderHistory(cachedRows).catch(() => {});
  loadHistory(cachedRows)
    .then(() => focusRequestedHistoryDate(
      mountPoint.querySelector('[data-croix-history-track]')
    ))
    .catch(() => {});
}

window.addEventListener('cid:croix-view-show', mount);
window.addEventListener('cid:site-config-loaded', refreshMountedComments);
window.addEventListener('cid:comments-settings-updated', refreshMountedComments);
window.addEventListener('cid:admin-config-updated', refreshMountedComments);
window.addEventListener('cid:cross-ready', () => {
  // The route can mount from the local archive before the live Croix has
  // finished restoring its validated payload. Once the source component is
  // ready, populate any history slots that were waiting for its DOM/CSS plane.
  const track = $('[data-croix-history-track]');
  if (!track) return;
  mountHistoricalCrosses(track);
  // The live Croix has just stored its official row locally: complete the
  // matching card in place (no request, no rebuild).
  if (document.body?.classList.contains('croix-active')
      && historyPosts(track).length) {
    renderHistory(cachedHistoryRows()).catch(() => {});
  }
});
window.addEventListener('cidgroup:illustrations-updated', () => {
  const track = $('[data-croix-history-track]');
  if (track) mountHistoricalCrosses(track);
});
window.addEventListener('cid:croix-history-updated', (event) => {
  const track = $('[data-croix-history-track]');
  const rows = event.detail?.rows;
  if (!track || !Array.isArray(rows)) return;
  // The dedicated route has already painted its local snapshot. A late
  // background reconciliation started by Accueil must not rebuild the
  // carousel underneath an active finger and move it to another day.
  if (document.body?.classList.contains('croix-active')
      || document.body?.dataset?.cidDedicatedView === 'croix') {
    return;
  }
  renderHistory(rows).catch(() => {});
});
window.addEventListener('cid:language-change', () => {
  if (!document.body?.classList.contains('croix-active')) return;
  mount();
});
if (document.body?.classList.contains('croix-active')) mount();
