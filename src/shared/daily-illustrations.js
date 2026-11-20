/*
 * Daily illustration catalogue — database driven.
 *
 * Illustration images remain administrator-owned rows of the secure database
 * (config_daily_illustrations). The accent colour, however, is a global
 * publication rule: every publication for a date follows the official Croix
 * colour assigned to that weekday.
 */
import {
  getNextProgrammeBoundary,
  getProgrammeDate as getSharedProgrammeDate
} from '/src/backend-server/methods/program-clock.js';
import { crossDayStyleForDate } from '/src/croix/cross-day-styles.js';

// Live reflection of the database rows, filled asynchronously. Empty until
// the first load; the views are re-applied once the configuration arrives.
const catalogue = {
  matrix: {},
  rejected: {},
  cross: {}
};
const colors = {};
function buildCatalogue(rows) {
  const entries = (Array.isArray(rows) ? rows : [])
    .filter((item) => item && item.enabled !== false)
    .filter((item) => (
      item.kind === 'matrix' || item.kind === 'rejected' || item.kind === 'cross'
    ));
  /*
   * An empty response can be a transient configuration/auth failure. Do not
   * replace a working catalogue with an empty one and make all artwork vanish.
   */
  if (!entries.length) return false;
  catalogue.matrix = {};
  catalogue.rejected = {};
  catalogue.cross = {};
  Object.keys(colors).forEach((key) => delete colors[key]);
  entries.forEach((item) => {
    const kindTable = item.kind === 'matrix' || item.kind === 'rejected' || item.kind === 'cross'
      ? catalogue[item.kind]
      : catalogue.matrix;
    if (item.exact_date) {
      kindTable[item.exact_date] = item.image_url || '';
    } else if (item.day !== null && item.day !== undefined && Number.isInteger(Number(item.day))) {
      kindTable[Number(item.day)] = item.image_url || '';
    }
    if (item.color) {
      const colorKey = item.exact_date
        || (item.day !== null && item.day !== undefined ? Number(item.day) : '');
      if (colorKey !== '') colors[colorKey] = item.color;
    }
  });
  return true;
}

const pad = (value) => String(value).padStart(2, '0');

function toIsoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fromIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12
  ));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getProgrammeDate(now = new Date()) {
  return getSharedProgrammeDate(now);
}

function getOfficialPublicationColor(date = getProgrammeDate()) {
  return crossDayStyleForDate(date).color;
}

function getConfiguredPublicationColor(date = getProgrammeDate()) {
  const dateObject = date instanceof Date
    ? date
    : fromIsoDate(date) || getProgrammeDate();
  const isoDate = toIsoDate(dateObject);
  const day = dateObject.getUTCDay();
  const configured = colors[isoDate] || colors[day];
  return /^#[0-9a-f]{6}$/i.test(String(configured || ''))
    ? String(configured)
    : '';
}

function getIllustration(kind, date = getProgrammeDate()) {
  const dateObject = date instanceof Date ? date : fromIsoDate(date) || getProgrammeDate();
  const isoDate = toIsoDate(dateObject);
  const day = dateObject.getUTCDay();
  const defaultColor = getOfficialPublicationColor(dateObject);
  let src = '';
  if (kind === 'cross') {
    // Prefer a date-specific publication image. When the administrator
    // configures a reusable weekday image (for example Friday), use it for
    // future dates too instead of leaving the currently displayed day's
    // image attached to the preview.
    src = catalogue.cross[isoDate] || catalogue.cross[day] || '';
  } else if (catalogue[kind]) {
    src = catalogue[kind][day] || '';
  }
  return {
    kind,
    date: isoDate,
    day,
    src,
    color: getOfficialPublicationColor(dateObject) || defaultColor,
    label: kind === 'matrix' ? 'Matrice du jour' : kind === 'rejected' ? 'Boules rejetées du jour' : 'Situation du jour'
  };
}

/*
 * One shared visual theme for the day's publications. Matrix and rejected
 * illustrations must follow the official Croix colour for the same programme
 * date, even when their own image catalogue entries have another accent.
 */
function getDailyIllustrationColor(date = getProgrammeDate()) {
  return getOfficialPublicationColor(date);
}

// A neutral accent remains available so the section keeps its visual rhythm
// even before the database replies; it is not a data source.
const DAILY_COLORS = new Proxy(colors, {
  get(target, prop) {
    return target[prop] || (prop === '1' ? '#2f73c5' : '#2f73c5');
  }
});

function getCrossTargetDate() {
  try {
    const stored = window.cidProgrammeState?.selectedDate || null;
    return fromIsoDate(stored) || getProgrammeDate();
  } catch (_) {
    return getProgrammeDate();
  }
}

function isHistoricalCrossRoot(root) {
  return Boolean(
    root?.dataset?.cidHistoryClone === 'true'
      || root?.classList?.contains('cid-fb-home-history-cross')
      || root?.classList?.contains('cid-croix-history-component')
  );
}

function canonicalCrossRoot() {
  return Array.from(document.querySelectorAll('#redCross')).find((root) => (
    !isHistoricalCrossRoot(root)
  )) || null;
}

function setImage(element, illustration) {
  if (!element || !illustration?.src) {
    /*
     * A temporary empty catalogue (offline response, auth refresh or a
     * delayed configuration load) must not erase the last valid artwork.
     * Keep a never-painted node hidden, but preserve any image already shown.
     */
    if (element && !element.dataset.illustrationSrc) element.hidden = true;
    return;
  }
  if (element.dataset.illustrationSrc === illustration.src &&
      element.dataset.illustrationDate === illustration.date) return;
  element.src = illustration.src;
  element.alt = `${illustration.label} — ${illustration.date}`;
  element.hidden = false;
  element.dataset.illustrationSrc = illustration.src;
  element.dataset.illustrationDate = illustration.date;
  element.dataset.illustrationColor = illustration.color;
}

/*
 * Apply the configured Croix artwork to any canonical Croix root.
 *
 * The live home component and every historical component use the same
 * coordinate plane. The only thing that changes per date is the configured
 * publication image selected from the catalogue.
 */
function applyCrossIllustration(root, programmeDate) {
  if (!root) return;
  if (isHistoricalCrossRoot(root)) {
    root.querySelector('.daily-cross-illustration')?.remove();
    root.classList.remove('has-daily-cross-illustration');
    return;
  }
  const illustration = getIllustration('cross', programmeDate);
  const existing = root.querySelector('.daily-cross-illustration');

  if (!illustration?.src) {
    /*
     * Do not remove a valid artwork just because the next config read is
     * empty. The previous image is safer and visually stable until a new
     * dated image arrives.
     */
    if (!existing) {
      root.classList.remove('has-daily-cross-illustration');
      root.dataset.illustrationDate = illustration?.date || '';
      root.dataset.illustrationColor = illustration?.color || '';
    }
    return;
  }

  const image = existing || document.createElement('img');
  image.className = 'daily-cross-illustration';
  setImage(image, illustration);
  image.hidden = false;
  root.appendChild(image);
  root.classList.add('has-daily-cross-illustration');
  root.dataset.illustrationDate = illustration.date;
  root.dataset.illustrationColor = illustration.color;
}

function applyDailyIllustrations() {
  const programmeDate = getProgrammeDate();
  const matrix = getIllustration('matrix', programmeDate);
  const rejected = getIllustration('rejected', programmeDate);
  const cross = getIllustration('cross', getCrossTargetDate());
  const dayColor = getDailyIllustrationColor(programmeDate);
  const root = document.documentElement;

  // Keep the persistent application chrome on the same official daily
  // palette as the Croix and the publication illustrations.
  root.style.setProperty('--cid-national-color', dayColor);
  root.style.setProperty('--daily-illustration-color', dayColor);
  root.style.setProperty('--daily-matrix-color', dayColor);
  root.style.setProperty('--daily-rejected-color', dayColor);

  setImage(document.getElementById('dailyMatrixIllustration'), matrix);
  setImage(document.getElementById('dailyRejectedIllustration'), rejected);
  document.querySelectorAll('.rejected-daily-illustration').forEach((image) => {
    setImage(image, rejected);
  });

  const crossRoot = canonicalCrossRoot();
  if (crossRoot) {
    applyCrossIllustration(crossRoot, getCrossTargetDate());
  }

  window.dispatchEvent(new CustomEvent('cidgroup:illustrations-updated', {
    detail: { programmeDate: toIsoDate(programmeDate), matrix, rejected, cross }
  }));
}

function scheduleDateRefresh() {
  const now = new Date();
  const nextBoundary = getNextProgrammeBoundary(now);
  setTimeout(() => {
    applyDailyIllustrations();
    scheduleDateRefresh();
  }, Math.max(1000, nextBoundary.getTime() - now.getTime()));
}

function init() {
  window.cidSiteConfig?.load?.().then((config) => {
    if (config && typeof config.dailyIllustrations === 'object') {
      const all = [];
      ['matrix', 'rejected', 'cross'].forEach((kind) => {
        const rows = config.dailyIllustrations[kind];
        if (Array.isArray(rows)) all.push(...rows);
      });
      buildCatalogue(all);
    }
    applyDailyIllustrations();
  }).catch(() => {
    applyDailyIllustrations();
  }).finally(() => {
    scheduleDateRefresh();
  });
}

const api = {
  catalogue,
  colors: DAILY_COLORS,
  getProgrammeDate,
  getIllustration,
  applyCrossIllustration,
  getOfficialPublicationColor,
  getConfiguredPublicationColor,
  getDailyIllustrationColor,
  applyDailyIllustrations,
  toIsoDate
};

window.cidDailyIllustrations = api;
window.getDailyIllustration = getIllustration;
window.getOfficialPublicationColor = getOfficialPublicationColor;
window.getDailyIllustrationColor = getDailyIllustrationColor;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init(), { once: true });
} else {
  init();
}

let lastCrossDate = '';
setInterval(() => {
  let current = '';
  try { current = window.cidProgrammeState?.selectedDate || ''; } catch (_) {}
  if (current !== lastCrossDate) {
    lastCrossDate = current;
    applyDailyIllustrations();
  }
}, 1500);

export {
  getProgrammeDate,
  getIllustration,
  applyCrossIllustration,
  getOfficialPublicationColor,
  getConfiguredPublicationColor,
  getDailyIllustrationColor,
  applyDailyIllustrations
};
