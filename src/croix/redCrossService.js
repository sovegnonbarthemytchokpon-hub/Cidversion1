/* Tombstone: redCrossService.js large implementation has been split into /src/cross/service.js for maintainability.
   The core helpers and heavy logic were moved; this file now acts as a compatibility shim while new module is the source of truth.
   removed fetch/apply heavy polling implementation.
*/
// redCrossService.js
// Refactored redCrossUpdater.js implementation moved here as an ES module for clarity and maintainability.
// This file contains the canonical polling, payload application and persistence logic previously in redCrossUpdater.js

import { recordCoreCalculation } from '/src/services/social-repository.js';
import { generateCroixNationaleProgramme } from '/src/services/secureProgrammeApi.js';
import { getProgrammeDate } from '/src/backend-server/methods/program-clock.js';
import {
  CROSS_DAY_STYLES,
  CROSS_DAY_COLORS,
  applyCrossDayStyle,
  crossDayStyleForDate
} from '/src/croix/cross-day-styles.js';

export {
  CROSS_DAY_STYLES,
  CROSS_DAY_COLORS,
  applyCrossDayStyle,
  crossDayStyleForDate
} from '/src/croix/cross-day-styles.js';

// Supabase remains the source of truth. The in-memory store prevents duplicate
// DOM work during a single page session; the persistent record cache below is
// only a paint cache and is always reconciled with Supabase when necessary.
const programmeMemory = new Map();
const PERSISTENT_GEOMETRY_KEY = /^(?:redCrossPositions(?:-|$)|canonicalRedCross(?:-|$)|lockDisplayedCross(?:-|$))/;
const CROSS_SNAPSHOT_KEY = 'cidgroup.cross.official.snapshot.v40';
const CROSS_SNAPSHOT_PREFIX = 'cidgroup.cross.official.date.v40:';
// This is a read-through paint cache only. Supabase remains authoritative for
// every programme; this cache lets the last validated row be shown instantly
// and remain available when the visitor is offline.
const CROSS_RECORD_CACHE_KEY = 'cidgroup.cross.official.records.v40';
const CROSS_RECORD_CACHE_LIMIT = 90;
// Official Croix results change at the 16:00 programme boundary. Keep a
// validated per-date result locally for that whole window so reloads and
// repeat visits paint instantly without repeating the Supabase read.
const CROSS_CACHE_FRESH_MS = 16 * 60 * 60 * 1000;
function uiLocale() {
  return String(
    window.cidTranslation?.current?.()
      || localStorage.getItem('cid_i18n_locale')
      || localStorage.getItem('userLang')
      || 'fr'
  ).replace('_', '-');
}

function uiDate(date, options) {
  return new Intl.DateTimeFormat(uiLocale(), options).format(date);
}

function uiText(value) {
  return window.cidI18n?.translate?.(value, uiLocale()) || value;
}

function refreshCrossLocalizedLabels(root = document) {
  const english = uiLocale().toLowerCase().startsWith('en');
  root.querySelectorAll('.term-title').forEach((element) => {
    const number = String(element.textContent || '').match(/\d+/)?.[0] || '0';
    element.textContent = `${english ? 'Terminal' : 'Terminaison'} ${number}`;
  });
  root.querySelectorAll('.right-label').forEach((element) => {
    element.textContent = uiText('Croix nationale');
  });
  root.querySelectorAll('.redCrossFooter').forEach((element) => {
    element.textContent = uiText('Notre site fonctionne. Allez sur www.cidmap.com');
  });
}

/*
 * Keep one request per programme date instead of one global request.
 *
 * The old single promise made a date selected from Historique join an
 * already-running request for the current publication. The title changed
 * immediately, but the visual could then receive the current day's payload
 * (or remain empty when that request did not contain the selected date).
 */
const fetchInFlight = new Map();
let lastSuccessfulRequestKey = '';
let lastSuccessfulRequestAt = 0;
const REQUEST_DEDUPE_WINDOW = 30 * 1000;
const programmeState = window.cidProgrammeState || {
  selectedDate: null,
  positions: Object.create(null),
  canonical: Object.create(null)
};
window.cidProgrammeState = programmeState;
const programmeStore = {
  getItem(key) {
    if (programmeMemory.has(key)) return programmeMemory.get(key);
    const normalizedKey = String(key || '');
    if (!PERSISTENT_GEOMETRY_KEY.test(normalizedKey)) return null;
    try {
      const value = localStorage.getItem(normalizedKey);
      if (value !== null) programmeMemory.set(normalizedKey, value);
      return value;
    } catch (_) {
      return null;
    }
  },
  setItem(key, value) {
    const normalizedKey = String(key || '');
    const normalizedValue = String(value);
    programmeMemory.set(normalizedKey, normalizedValue);
    if (!PERSISTENT_GEOMETRY_KEY.test(normalizedKey)) return;
    try { localStorage.setItem(normalizedKey, normalizedValue); } catch (_) {}
  },
  removeItem(key) {
    programmeMemory.delete(key);
    const normalizedKey = String(key || '');
    if (!PERSISTENT_GEOMETRY_KEY.test(normalizedKey)) return;
    try { localStorage.removeItem(normalizedKey); } catch (_) {}
  }
};

window.__cidDatabaseDiagnostics = window.__cidDatabaseDiagnostics || {
  provider: 'supabase',
  table: 'croix_nationale_generations',
  reads: 0,
  writes: 0,
  lastRequest: null,
  lastError: null
};

function noteDatabaseRequest(type, detail = {}) {
  const diagnostics = window.__cidDatabaseDiagnostics;
  diagnostics[type === 'read' ? 'reads' : 'writes'] += 1;
  diagnostics.lastRequest = {
    type,
    at: new Date().toISOString(),
    ...detail
  };
}

function noteDatabaseError(error) {
  window.__cidDatabaseDiagnostics.lastError = String(error?.message || error || 'Erreur Supabase');
}

function programmeIso(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

function normalizeOfficialCachedRecord(value) {
  if (!value) return null;
  const programmeDate = programmeIso(value.programmeDate || value.programme_date);
  const assignment = Array.isArray(value.assignment)
    ? value.assignment.map(String).slice(0, 8)
    : Array.isArray(value.numbers)
      ? value.numbers.map(String).slice(0, 8)
      : [];
  if (!programmeDate || assignment.length !== 8) return null;
  return {
    id: value.id || null,
    programmeDate,
    year: Number(value.year ?? value.generated_year) || 0,
    month: Number(value.month ?? value.generated_month) || 0,
    scope: String(value.scope || value.scope_key || ''),
    term: String(value.term || ''),
    removedDigits: Array.isArray(value.removedDigits)
      ? value.removedDigits.map(String).slice(0, 2)
      : Array.isArray(value.removed_digits)
        ? value.removed_digits.map(String).slice(0, 2)
        : [],
    terminaison: String(value.terminaison || value.visible_terminaison || ''),
    dateSum: Number(value.dateSum ?? value.date_sum) || 0,
    dateDigitSum: Number(value.dateDigitSum ?? value.date_digit_sum) || 0,
    dateFinishingDigit: Number(value.dateFinishingDigit ?? value.date_finishing_digit) || 0,
    assignment,
    alignments: value.alignments || value.crossLineGroups || {},
    signature: String(value.signature || ''),
    createdAt: value.createdAt || value.created_at || null,
    savedAt: value.savedAt || value.saved_at || null,
    verifiedAt: value.verifiedAt || null,
    snapshot: value.snapshot || null
  };
}

function readOfficialCrossRecord(date) {
  const dateIso = programmeIso(date);
  if (!dateIso) return null;
  try {
    const cache = JSON.parse(localStorage.getItem(CROSS_RECORD_CACHE_KEY) || '{}');
    return normalizeOfficialCachedRecord(cache?.records?.[dateIso]);
  } catch (_) {
    return null;
  }
}

function writeOfficialCrossRecord(value, { verifiedAt = null } = {}) {
  const record = normalizeOfficialCachedRecord(value);
  if (!record) return null;
  try {
    const cache = JSON.parse(localStorage.getItem(CROSS_RECORD_CACHE_KEY) || '{}');
    const records = cache && typeof cache.records === 'object' && !Array.isArray(cache.records)
      ? cache.records
      : {};
    const previous = normalizeOfficialCachedRecord(records[record.programmeDate]);
    const next = {
      ...previous,
      ...record,
      // A cached paint must not make an old row look freshly verified.
      savedAt: record.savedAt || previous?.savedAt || new Date().toISOString(),
      verifiedAt: verifiedAt || record.verifiedAt || previous?.verifiedAt || null
    };
    records[record.programmeDate] = next;
    const entries = Object.entries(records)
      .sort(([, left], [, right]) =>
        Date.parse(right?.verifiedAt || right?.savedAt || '') -
        Date.parse(left?.verifiedAt || left?.savedAt || ''))
      .slice(0, CROSS_RECORD_CACHE_LIMIT);
    localStorage.setItem(CROSS_RECORD_CACHE_KEY, JSON.stringify({
      version: 2,
      historyVerifiedAt: cache.historyVerifiedAt || null,
      historyLimit: Number(cache.historyLimit || 0),
      historyComplete: Boolean(cache.historyComplete),
      records: Object.fromEntries(entries)
    }));
    return normalizeOfficialCachedRecord(next);
  } catch (_) {
    // Storage may be blocked or full. The live database path must still work.
    return record;
  }
}

function officialRecordPayload(record, cachedOfficial = true) {
  const normalized = normalizeOfficialCachedRecord(record);
  if (!normalized) return null;
  return {
    meta: {
      term: normalized.term,
      removedDigits: normalized.removedDigits,
      programmeDate: normalized.programmeDate,
      targetDate: normalized.programmeDate,
      assignment: normalized.assignment,
      crossNumbers: normalized.assignment,
      dateSum: normalized.dateSum,
      dateDigitSum: normalized.dateDigitSum,
      dateFinishingDigit: normalized.dateFinishingDigit,
      terminaison: normalized.terminaison,
      crossLineGroups: normalized.alignments,
      signature: normalized.signature,
      persisted: true,
      supabaseSource: true,
      cachedOfficial: Boolean(cachedOfficial)
    },
    results: []
  };
}

function isOfficialCacheFresh(record) {
  const timestamp = Date.parse(record?.verifiedAt || record?.savedAt || '');
  return Number.isFinite(timestamp) && Date.now() - timestamp <= CROSS_CACHE_FRESH_MS;
}

function cachedRecordToGeneration(record) {
  return {
    id: record.id,
    programme_date: record.programmeDate,
    generated_year: record.year,
    generated_month: record.month,
    scope_key: record.scope,
    term: record.term,
    removed_digits: record.removedDigits,
    visible_terminaison: record.terminaison,
    date_sum: record.dateSum,
    date_digit_sum: record.dateDigitSum,
    date_finishing_digit: record.dateFinishingDigit,
    assignment: record.assignment,
    alignments: record.alignments,
    signature: record.signature,
    created_at: record.createdAt || null
  };
}

// Archive readers use the same cache as the live Croix. These helpers expose
// only published rows; they never expose or reproduce calculation rules.
export function getCachedCroixGenerations(limit = 31) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 31));
  try {
    const cache = JSON.parse(localStorage.getItem(CROSS_RECORD_CACHE_KEY) || '{}');
    return Object.values(cache?.records || {})
      .map(normalizeOfficialCachedRecord)
      .filter(Boolean)
      .sort((left, right) => right.programmeDate.localeCompare(left.programmeDate))
      .slice(0, safeLimit)
      .map(cachedRecordToGeneration);
  } catch (_) {
    return [];
  }
}

export function isCroixArchiveCacheFresh(limit = 31) {
  try {
    const cache = JSON.parse(localStorage.getItem(CROSS_RECORD_CACHE_KEY) || '{}');
    const verifiedAt = Date.parse(cache?.historyVerifiedAt || '');
    const requestedLimit = Math.min(100, Math.max(1, Number(limit) || 31));
    const cachedLimit = Number(cache?.historyLimit || 0);
    const historyComplete = Boolean(cache?.historyComplete);
    // The archive is up to date as soon as the current publication is
    // stored with enough previous days: nothing new can exist before the
    // next programme date, whatever the age of the cache.
    const currentIso = programmeIso(getProgrammeDate(new Date()));
    const records = cache?.records && typeof cache.records === 'object' ? cache.records : {};
    const windowDays = Math.min(requestedLimit, 9);
    const hasWindow = Boolean(currentIso) && Array.from({ length: windowDays }, (_, index) => {
      const day = new Date(`${currentIso}T12:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() - index);
      return Boolean(records[day.toISOString().slice(0, 10)]);
    }).every(Boolean);
    if (hasWindow && (historyComplete || cachedLimit >= requestedLimit || requestedLimit <= 9)) {
      return true;
    }
    return Number.isFinite(verifiedAt)
      && Date.now() - verifiedAt <= CROSS_CACHE_FRESH_MS
      && (historyComplete || cachedLimit >= requestedLimit);
  } catch (_) {
    return false;
  }
}

export function cacheCroixGenerations(
  rows,
  verifiedAt = new Date().toISOString(),
  requestedLimit = Array.isArray(rows) ? rows.length : 0
) {
  const values = Array.isArray(rows) ? rows : [];
  values.forEach((row) => {
    writeOfficialCrossRecord(row, { verifiedAt });
  });
  try {
    const cache = JSON.parse(localStorage.getItem(CROSS_RECORD_CACHE_KEY) || '{}');
    localStorage.setItem(CROSS_RECORD_CACHE_KEY, JSON.stringify({
      version: 2,
      historyVerifiedAt: verifiedAt,
      historyLimit: Math.max(Number(cache?.historyLimit || 0), Number(requestedLimit) || 0),
      historyComplete: values.length < (Number(requestedLimit) || values.length),
      records: cache?.records || {}
    }));
  } catch (_) {
    // The database path remains authoritative if browser storage is blocked.
  }
}

function saveOfficialCrossSnapshot(computed, assignment, { verifiedAt = null } = {}) {
  try {
    const date = programmeIso(computed?.programmeDate);
    const rc = document.getElementById('redCross');
    const positions = rc
      ? Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0, 8).map((element) => ({
        left: element.style.left || getComputedStyle(element).left || '',
        top: element.style.top || getComputedStyle(element).top || '',
        transform: element.style.transform || getComputedStyle(element).transform || '',
        fontSize: element.style.fontSize || getComputedStyle(element).fontSize || ''
      }))
      : [];
    const existing = readOfficialCrossRecord(date);
    const snapshot = {
      programmeDate: date,
      positionVersion: OFFICIAL_CROSS_POSITION_VERSION,
      term: String(computed?.term || ''),
      terminaison: String(computed?.terminaison || ''),
      removedDigits: Array.isArray(computed?.removedDigits)
        ? computed.removedDigits.map(String).slice(0, 2)
        : [],
      assignment: Array.isArray(assignment) ? assignment.map(String).slice(0, 8) : [],
      background: rc ? getComputedStyle(rc).backgroundColor : '',
      positions,
      savedAt: new Date().toISOString()
    };
    writeOfficialCrossRecord({
      ...existing,
      programmeDate: date,
      term: computed?.term,
      removedDigits: computed?.removedDigits,
      terminaison: computed?.terminaison,
      dateSum: computed?.dateSum,
      dateDigitSum: computed?.dateDigitSum,
      dateFinishingDigit: computed?.dateFinishingDigit,
      assignment,
      alignments: computed?.crossLineGroups,
      signature: computed?.signature,
      savedAt: existing?.savedAt || snapshot.savedAt,
      snapshot
    }, { verifiedAt });
    // The old snapshot keys are read only for one-way migration. All new
    // writes go through the single per-date record cache.
  } catch (_) {
    // Private browsing and blocked storage must never stop the live request.
  }
}

function restoreOfficialCrossSnapshot() {
  try {
    const currentDate = programmeIso(getProgrammeDate(new Date()));
    let cached = readOfficialCrossRecord(currentDate);
    // Migrate the previous single-snapshot format if it is all the visitor
    // has. It is still only a paint cache and is never treated as authority.
    if (!cached) {
      const raw = localStorage.getItem(`${CROSS_SNAPSHOT_PREFIX}${currentDate}`)
        || localStorage.getItem(CROSS_SNAPSHOT_KEY);
      const legacy = raw ? JSON.parse(raw) : null;
      cached = normalizeOfficialCachedRecord(legacy);
      if (cached) writeOfficialCrossRecord(cached);
    }
    if (!cached) {
      return false;
    }
    const payload = officialRecordPayload(cached, true);
    if (!payload) return false;
    applyPayload(payload);
    const rc = document.getElementById('redCross');
    if (rc) {
      const snapshot = cached.snapshot || cached;
      // Keep the Monday update effective for visitors with an older cached
      // snapshot; all other weekdays retain their stored appearance.
      const cachedDate = parseCrossDate(cached.programmeDate);
      if (cachedDate?.getDay() === 1) {
        rc.style.setProperty('background', CROSS_DAY_COLORS[1], 'important');
      } else if (snapshot.background) {
        rc.style.setProperty('background', snapshot.background, 'important');
      }
      /*
       * Geometry snapshots are versioned. Never reapply a legacy pixel
       * layout after the official national coordinate plane has changed;
       * the current canonical CSS/position contract is the fallback.
       */
      if (snapshot.positionVersion === OFFICIAL_CROSS_POSITION_VERSION
          && Array.isArray(snapshot.positions)) {
        rc.querySelectorAll('.cross-numbers .num').forEach((element, index) => {
          const position = snapshot.positions[index];
          if (!position) return;
          if (position.left) element.style.setProperty('left', position.left, 'important');
          if (position.top) element.style.setProperty('top', position.top, 'important');
          if (position.transform) element.style.setProperty('transform', position.transform, 'important');
          if (position.fontSize) element.style.setProperty('font-size', position.fontSize, 'important');
        });
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function parseCrossDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const french = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (french) {
    const date = new Date(Number(french[3]), Number(french[2]) - 1, Number(french[1]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAnticipationSurface() {
  return document.body.classList.contains('anticipation-active')
    || document.body.dataset.cidDedicatedView === 'anticipe';
}

function isCrossSurfaceActive() {
  return document.body.classList.contains('croix-active')
    || document.body.dataset.cidDedicatedView === 'croix'
    || window.__currentCategory === 'croix';
}

function getRequestedCrossDate(payload) {
  // The date picker wins over a payload from another date. It is session
  // state, not persisted programme data.
  const selected = parseCrossDate(programmeState.selectedDate);
  if (selected && isCrossSurfaceActive()) return selected;
  // An early-access date belongs exclusively to the Anticipé route. Never
  // let unlocking a future Croix replace the official current Croix on
  // Accueil; Anticipé renders the future payload in its own card.
  const anticipationActive = isAnticipationSurface();
  if (!anticipationActive) return null;
  const anticipated = window.cidEarlyAccessUi?.programmeDateFor?.('croix');
  return anticipated ? parseCrossDate(anticipated) : null;
}

/*
 * Croix Nationale rules remain server-only. The browser keeps only the
 * validated result returned by Supabase so it can render the cross.
 */
let secureCrossState = null;

function crossStateFromPayload(value) {
  const source = value?.meta || value || {};
  const dateValue = source.programmeDate || source.targetDate || source.programme_date;
  const programmeDate = parseCrossDate(dateValue);
  const assignment = Array.isArray(source.assignment)
    ? source.assignment
    : source.crossNumbers;
  if (!programmeDate || !Array.isArray(assignment) || assignment.length !== 8) return null;

  const asStrings = (items) => Array.isArray(items) ? items.map(String) : [];
  return {
    term: String(source.term || ''),
    removedDigits: asStrings(source.removedDigits),
    terminaison: String(source.terminaison || ''),
    programmeDate,
    dateSum: Number(source.dateSum) || 0,
    dateDigitSum: Number(source.dateDigitSum) || 0,
    dateFinishingDigit: Number(source.dateFinishingDigit) || 0,
    crossNumbers: asStrings(assignment),
    crossLineGroups: Array.isArray(source.crossLineGroups) ? source.crossLineGroups : [],
    signature: String(source.signature || '')
  };
}

function rememberSecureCrossState(value) {
  const next = crossStateFromPayload(value);
  if (next) secureCrossState = next;
  return next || secureCrossState;
}

// Compatibility snapshot for existing UI modules. This returns server data
// only; it contains no calculation rules.
export function computeTodayTermAndRemoved() {
  return secureCrossState;
}

function normalizeSupabaseCross(row) {
  if (!row) return null;
  const arrayValue = (value) => {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value); } catch (_) { return []; }
  };
  return {
    id: row.id,
    programmeDate: row.programme_date,
    year: row.generated_year,
    month: row.generated_month,
    scope: row.scope_key,
    term: row.term,
    removedDigits: arrayValue(row.removed_digits).map(String),
    dateSum: row.date_sum,
    dateDigitSum: row.date_digit_sum,
    dateFinishingDigit: row.date_finishing_digit,
    dateFinishing: String(row.date_finishing_digit).padStart(2, '0'),
    terminaison: row.visible_terminaison,
    assignment: arrayValue(row.assignment).map(String),
    alignments: typeof row.alignments === 'object'
      ? row.alignments
      : arrayValue(row.alignments),
    signature: row.signature,
    createdAt: row.created_at
  };
}

async function requestSupabaseCross(date, scope = 'year') {
  const dateIso = date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
  if (!dateIso) return null;
  try {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client) return null;
    noteDatabaseRequest('read', { date: dateIso, scope });
    const { data, error } = await bridge.client
      .from('croix_nationale_generations')
      .select('*')
      .eq('programme_date', dateIso)
      .maybeSingle();
    if (error) {
      noteDatabaseError(error);
      return null;
    }
    if (!data) return null;
    return normalizeSupabaseCross(data);
  } catch (error) {
    noteDatabaseError(error);
    return null;
  }
}

async function requestServerCross(date, scope = 'year') {
  // The official row is normally already persisted for the current
  // programme. Read it first so every visitor gets a fast, immutable result
  // instead of invoking the protected generator on every page load.
  const lookupDate = date || getRequestedCrossDate()
    || getProgrammeDate(new Date());
  const supabaseRecord = await requestSupabaseCross(lookupDate, scope);
  if (supabaseRecord) return { ...supabaseRecord, persisted: true, supabaseSource: true };

  const configuredSupabase = Boolean((await window.cidSupabaseReady)?.client);
  if (configuredSupabase) {
    const dateIso = date && !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 10)
      : null;
    try {
      const secureRecord = await generateCroixNationaleProgramme({
        date: dateIso,
        scope
      });
      noteDatabaseRequest('secure-function', { date: dateIso, scope });
      return { ...secureRecord, persisted: true, secureFunction: true };
    } catch (error) {
      noteDatabaseError(error);
      console.warn('La fonction Edge croix-nationale est indisponible.', error);
    }
  }
  noteDatabaseError('Fonction sécurisée indisponible');
  return null;
}

/*
 * Read one already validated Croix row for a dedicated view. This adapter
 * never derives numbers in the browser: it uses the same Supabase row or
 * protected function as the live Croix component.
 */
export async function fetchCroixProgrammeForDate(value, scope = 'year') {
  const date = parseCrossDate(value);
  if (!date) throw new Error('Date de Croix invalide.');
  /*
   * localStorage first. A published Croix row never changes for its date, so
   * an already stored row (today or an archive day) is returned without any
   * database request, including offline. Future (Anticipé) dates stay
   * strictly server-side because they depend on an access grant.
   */
  const dateIso = programmeIso(date);
  const currentIso = programmeIso(getProgrammeDate(new Date()));
  const isPublishedDate = Boolean(dateIso && currentIso && dateIso <= currentIso);
  if (isPublishedDate) {
    const cached = readOfficialCrossRecord(dateIso);
    if (cached && Array.isArray(cached.assignment) && cached.assignment.length) {
      return { ...cached, persisted: true, cachedOfficial: true };
    }
  }
  const record = await requestServerCross(date, scope);
  if (!record) throw new Error('Publication Croix indisponible.');
  if (isPublishedDate) {
    writeOfficialCrossRecord({
      ...record,
      savedAt: new Date().toISOString()
    }, { verifiedAt: new Date().toISOString() });
  }
  return record;
}

function crossNumberTransform(element) {
  return element?.classList.contains('n2')
    ? 'translate(-50%,-50%) translateY(calc(-10px * var(--cross-scale, 1)))'
    : 'translate(-50%,-50%)';
}

const OFFICIAL_CROSS_POSITION_VERSION = 'cross-national-fixed-geometry-v2';

function clearLegacyCrossColorOverrides(root) {
  if (!root) return;
  root.style.removeProperty('background');
  root.style.removeProperty('background-color');

  const colorSelectors = [
    '.cross-numbers .num',
    '#redCrossDate',
    '#redCrossDate-clone',
    '.term-title',
    '.term-paren',
    '.right-label',
    '.redCrossFooter',
    '.sunday-button',
    '.black-square-btn'
  ];
  root.querySelectorAll(colorSelectors.join(',')).forEach((element) => {
    [
      'color',
      '-webkit-text-fill-color',
      '-webkit-text-stroke',
      '-webkit-text-stroke-color',
      'text-stroke',
      'text-shadow',
      'background',
      'background-color',
      'border',
      'border-color',
      'fill',
      'stroke'
    ].forEach((property) => element.style.removeProperty(property));
  });
  root.querySelectorAll('svg .cross-line').forEach((line) => {
    line.style.removeProperty('stroke');
  });
  root.querySelectorAll('.black-square-btn svg circle').forEach((circle) => {
    circle.style.removeProperty('fill');
    circle.style.removeProperty('stroke');
  });
  root.querySelectorAll('.black-square-btn svg text, .black-square-btn svg textPath')
    .forEach((text) => text.style.removeProperty('fill'));
}

function applyCanonicalCrossColor(root, color, ink, day) {
  if (!root) return;
  root.dataset.crossDay = String(day);
  root.dataset.crossInk = ink === '#000000' ? 'dark' : 'light';
  root.style.setProperty('--cid-cross-color', color, 'important');
  root.style.setProperty('--cid-cross-ink', ink, 'important');
  clearLegacyCrossColorOverrides(root);
}

function applyCanonicalCrossColors(color, ink, day) {
  applyCanonicalCrossColor(document.getElementById('redCross'), color, ink, day);
  applyCanonicalCrossColor(document.getElementById('redCrossClone'), color, ink, day);
}

// applyPayload: apply canonical / computed cross state into DOM (safe, non-destructive)
export function applyPayload(payload){
  try {
    // Anticipé owns a separate visual clone. Never paint its future payload
    // into the live Accueil cross or the document-level theme variables.
    if (isAnticipationSurface()) return false;
    const rc = document.getElementById('redCross');
    if (!rc) return;
    // The browser only paints the validated record returned by Supabase.
    // Parse first so a stale response cannot become the in-memory fallback
    // while a different archive date is active.
    const computed = crossStateFromPayload(payload);
    if (!computed) return;

    /*
     * A response from an earlier/current-date request must never overwrite a
     * date explicitly selected in the archive. This is intentionally checked
     * at the final DOM boundary as well as in the request routing below:
     * cached responses, legacy callers and background polling all converge
     * here.
     */
    const requestedDate = getRequestedCrossDate();
    const computedDate = programmeIso(computed.programmeDate);
    if (
      requestedDate
      && isCrossSurfaceActive()
      && computedDate !== programmeIso(requestedDate)
    ) {
      return false;
    }
    rememberSecureCrossState(payload);

    const removed = computed.removedDigits.map(String);
    const termEl = rc.querySelector('.term-paren');
    if (termEl) termEl.textContent = computed.term;
    refreshCrossLocalizedLabels(rc);
    try { programmeState.removedDigits = removed.slice(); } catch(_){}

    // Display the same calendar date that produced the assignment. Cached
    // payload metadata may belong to another draw and is deliberately ignored.
    try {
      const rcDateEl = rc.querySelector('#redCrossDate');
      if (rcDateEl) {
        rcDateEl.textContent = uiDate(computed.programmeDate, {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
      }
    } catch(e){}

    // determine programmeDate for weekday dependent visuals
    const programmeDate = computed.programmeDate;
    const dayStyle = crossDayStyleForDate(programmeDate);
    const programmeDateIso = programmeDate && !Number.isNaN(programmeDate.getTime())
      ? programmeDate.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const w = dayStyle.day;

    // background colour mapping per weekday
    applyCrossDayStyle(rc, programmeDate);
    rc.style.background = dayStyle.color || rc.style.background;
    const clone = document.getElementById('redCrossClone');
    if (clone) {
      applyCrossDayStyle(clone, programmeDate);
      clone.style.background = rc.style.background;
    }
    const dayColor = dayStyle.color;
    const textColor = dayStyle.ink;

    // expose day color as a CSS custom property so UI elements (copy buttons etc.) can adopt the cross color
    try { document.documentElement.style.setProperty('--redCross-bg', dayColor); } catch(e){}
    
    // Ensure the displayed cross date is updated and its text color contrasts with the day's color
    try {
      const rcDateEl = rc.querySelector('#redCrossDate') || document.getElementById('redCrossDate');
      if (rcDateEl) {
        const dateToShow = programmeDate;
        try {
        rcDateEl.textContent = uiDate(dateToShow, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        } catch(e) {
          rcDateEl.textContent = dateToShow.toDateString();
        }
        // set contrasting text color (already computed above as textColor)
        try { rcDateEl.style.setProperty('color', textColor, 'important'); rcDateEl.style.setProperty('-webkit-text-fill-color', textColor, 'important'); } catch(e){}
      }
    } catch(e){}
    
    // ensure the circular button text uses the day's column color on a white button background
    try {
      // Paint every layer of the 5/90 control from the same day colour:
      // disc, ring inscription and the button's inherited SVG styles. The
      // central value keeps a contrasting foreground.
      const controlForeground = textColor;
      const controlInk = textColor === '#000000' ? textColor : dayColor;
      rc.querySelectorAll('.black-square-btn svg circle').forEach(el => {
        el.style.setProperty('fill', dayColor, 'important');
        el.style.setProperty('stroke', dayColor, 'important');
      });
      rc.querySelectorAll('.black-square-btn svg textPath').forEach(el => { el.style.setProperty('fill', controlInk, 'important'); });
      rc.querySelectorAll('.black-square-btn svg text').forEach(el => {
        const txt = (el.textContent || '').trim();
        el.style.setProperty('fill', txt === '5/90' ? controlForeground : dayColor, 'important');
      });
      // ensure the button background is white to make the day color visible
      rc.querySelectorAll('.black-square-btn').forEach(btn => {
        btn.style.setProperty('background', '#ffffff', 'important');
        btn.style.setProperty('color', dayColor, 'important');
        btn.style.setProperty('border-color', 'rgba(0,0,0,0.06)', 'important');
      });
      // also apply to cloned cross if present
      if (clone) {
        clone.querySelectorAll('.black-square-btn svg circle').forEach(el => {
          el.style.setProperty('fill', dayColor, 'important');
          el.style.setProperty('stroke', dayColor, 'important');
        });
        clone.querySelectorAll('.black-square-btn svg textPath').forEach(el => { el.style.setProperty('fill', controlInk, 'important'); });
        clone.querySelectorAll('.black-square-btn svg text').forEach(el => {
          const txt = (el.textContent || '').trim();
          el.style.setProperty('fill', txt === '5/90' ? controlForeground : dayColor, 'important');
        });
        clone.querySelectorAll('.black-square-btn').forEach(btn => {
          btn.style.setProperty('background', '#ffffff', 'important');
          btn.style.setProperty('color', dayColor, 'important');
          btn.style.setProperty('border-color', 'rgba(0,0,0,0.06)', 'important');
        });
      }
    } catch(e) { /* non-fatal */ }

    // Ensure the NATIONALE (.sunday-button) adopts the day's color with
    // a contrasting label and border.
    try {
      rc.querySelectorAll('.sunday-button').forEach(btn => {
        btn.style.setProperty('background', dayColor, 'important');
        btn.style.setProperty('color', textColor, 'important');
        btn.style.setProperty('-webkit-text-fill-color', textColor, 'important');
        btn.style.setProperty('border', `2px solid ${textColor}`, 'important');
        btn.style.setProperty('box-shadow', '0 6px 18px rgba(0,0,0,0.18)', 'important');
      });
      if (clone) {
        clone.querySelectorAll('.sunday-button').forEach(btn => {
          btn.style.setProperty('background', dayColor, 'important');
          btn.style.setProperty('color', textColor, 'important');
          btn.style.setProperty('-webkit-text-fill-color', textColor, 'important');
          btn.style.setProperty('border', `2px solid ${textColor}`, 'important');
          btn.style.setProperty('box-shadow', '0 6px 18px rgba(0,0,0,0.18)', 'important');
        });
      }
    } catch (e) { /* non-fatal */ }

    const numsEls = Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0,8);
    if (numsEls.length < 8) return;

    // The server has already validated the assignment and the associated
    // metadata. The browser only paints those values and never reproduces the
    // method that selected them. Positions/classes are untouched.
    const authoritativeAssignment = payload?.meta?.assignment || payload?.meta?.crossNumbers;
    const finalAssignment = Array.isArray(authoritativeAssignment)
      ? authoritativeAssignment.map(Number)
      : Array.isArray(computed.crossNumbers)
        ? computed.crossNumbers.map(Number)
      : [];
    if (finalAssignment.length !== 8 || finalAssignment.some(Number.isNaN)) return;

    // apply assignment non-destructively
    finalAssignment.forEach((val, i) => {
      const el = numsEls[i];
      if (!el) return;
      el.textContent = String(val);
    });

    // persist and expose the chosen unique assignment for this programme date so all visitors see the same
    try {
      const rcEl = document.getElementById('redCross');
      if (rcEl) {
        const programmeDateIso = programmeDate && !Number.isNaN(programmeDate.getTime()) ? programmeDate.toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
        const key = `redCrossAssignment-${programmeDateIso}`;
        // store canonical assignment only once per programme date to keep it unique and immutable
        if (!programmeStore.getItem(key)) {
          programmeStore.setItem(key, JSON.stringify({
            assignment: finalAssignment.slice(0,8).map(String),
            removedDigits: removed.slice(0, 2),
            dateSum: computed.dateSum,
            dateDigitSum: computed.dateDigitSum,
            dateFinishingDigit: computed.dateFinishingDigit,
            appliedAt: new Date().toISOString(),
            method: 'date-sum-v2'
          }));
        }
        // expose on DOM for downstream consumers: single canonical slot descriptor
        rcEl.dataset.canonicalAssignment = JSON.stringify(finalAssignment.slice(0,8).map(String));
        rcEl.dataset.canonicalDate = programmeDate && !Number.isNaN(programmeDate.getTime()) ? programmeDate.toISOString().slice(0,10) : '';
      }
    } catch(e){}
    
    // === ENFORCE IMMUTABLE CANONICAL POSITIONS ===
    // Ensure numbers stay exactly where they were placed for the published date:
    //  - write left/top inline with !important
    //  - disable transitions and animations
    //  - prevent later scripts or CSS from moving numbers by observing style changes and restoring canonical values
    try {
      const rcEl = document.getElementById('redCross');
      if (rcEl) {
        const programmeDateIso = programmeDate && !Number.isNaN(programmeDate.getTime()) ? programmeDate.toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
        const positionsKey = `redCrossPositions-${programmeDateIso}`;
        // build canonical positions array from current DOM (if not already persisted)
        const canonicalPositions = Array.from(numsEls.slice(0,8)).map(el => ({
          text: (el.textContent||'').trim(),
          left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
          top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50,
          fontSize: el.style.fontSize || getComputedStyle(el).fontSize || null,
          transform: crossNumberTransform(el)
        }));
        // persist canonical positions for this date (idempotent)
        try {
          const officialSnapshot = {
            positions: canonicalPositions,
            savedAt: new Date().toISOString(),
            official: true,
            positionVersion: OFFICIAL_CROSS_POSITION_VERSION
          };
          let storedSnapshot = null;
          try { storedSnapshot = JSON.parse(programmeStore.getItem(positionsKey) || 'null'); } catch(_) {}
          if (storedSnapshot?.positionVersion !== OFFICIAL_CROSS_POSITION_VERSION) {
            programmeStore.setItem(positionsKey, JSON.stringify(officialSnapshot));
          }
          programmeStore.setItem('redCrossPositionsLatest', JSON.stringify({
            ...officialSnapshot,
            date: programmeDateIso
          }));
          try {
            const canonicalRaw = programmeStore.getItem('canonicalRedCross');
            const canonical = canonicalRaw ? JSON.parse(canonicalRaw) : null;
            if (canonical && typeof canonical === 'object' && !Array.isArray(canonical)) {
              canonical.positions = canonicalPositions;
              canonical.positionVersion = OFFICIAL_CROSS_POSITION_VERSION;
              canonical.positionAdjustment = {
                slot: 'n2',
                transform: crossNumberTransform(numsEls.find(el => el.classList.contains('n2')))
              };
              programmeStore.setItem('canonicalRedCross', JSON.stringify(canonical));
            }
          } catch(_) {}
        } catch(_) {}

        // apply and lock positions immediately using inline styles with high priority
        (function lockPositions() {
          numsEls.slice(0,8).forEach((el, idx) => {
            const p = canonicalPositions[idx];
            if (!p) return;
            // set absolute percent positions and styles with !important to avoid CSS overrides
            el.style.setProperty('left', String(p.left) + '%', 'important');
            el.style.setProperty('top', String(p.top) + '%', 'important');
            el.style.setProperty('transform', crossNumberTransform(el), 'important');
            if (p.fontSize) el.style.setProperty('font-size', p.fontSize, 'important');
            // disable transitions and heavy effects
            el.style.setProperty('transition', 'none', 'important');
            el.style.setProperty('will-change', 'auto', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            el.style.setProperty('user-select', 'none', 'important');
          });
          // also disable cross container transitions to avoid propagation
          rcEl.style.setProperty('transition', 'none', 'important');
          rcEl.dataset.positionsLocked = 'true';
        })();

        // Observe any attempted style changes and immediately restore canonical values (prevents later scripts from moving numbers)
        // keep only one observer per rcEl
        if (!rcEl._positionsObserver) {
          const observer = new MutationObserver((mutations) => {
            let restored = false;
            mutations.forEach(m => {
              if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('num')) {
                const els = Array.from(rcEl.querySelectorAll('.cross-numbers .num')).slice(0,8);
                const storedRaw = programmeStore.getItem(`redCrossPositions-${programmeDateIso}`) || programmeStore.getItem('redCrossPositionsLatest');
                let stored = null;
                try { stored = storedRaw ? JSON.parse(storedRaw).positions || JSON.parse(storedRaw) : null; } catch(e){ stored = null; }
                if (Array.isArray(stored) && stored.length >= 8) {
                  els.forEach((el, i) => {
                    const p = stored[i];
                    if (!p) return;
                    // restore immediately
                    el.style.setProperty('left', String(p.left) + '%', 'important');
                    el.style.setProperty('top', String(p.top) + '%', 'important');
                    el.style.setProperty('transform', crossNumberTransform(el), 'important');
                    el.style.setProperty('transition', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                    restored = true;
                  });
                }
              }
            });
            // micro-batch: if restorations happened, briefly re-assert container locking
            if (restored) {
              try {
                rcEl.style.setProperty('transition', 'none', 'important');
                rcEl.dataset.positionsLocked = 'true';
              } catch(_) {}
            }
          });
          observer.observe(rcEl, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
          rcEl._positionsObserver = observer;
        }
      }
    } catch (errLock) {
      console.warn('Failed to enforce locked cross positions', errLock);
    }

    // Persist the current date-specific canonical assignment. The legacy
    // unscoped key is kept as a pointer for copy/share consumers, but it must
    // follow the active date instead of freezing the first assignment ever
    // displayed.
    try {
      const savedPayload = {
        meta: {
          term: computed.term,
          removedDigits: removed.slice(0, 2),
          programmeDate: programmeDate.toISOString(),
          dateSum: computed.dateSum,
          dateDigitSum: computed.dateDigitSum,
          dateFinishingDigit: computed.dateFinishingDigit
        },
        numbers: finalAssignment.slice(0,8).map(n => String(n)),
        positionVersion: OFFICIAL_CROSS_POSITION_VERSION,
        positionAdjustment: {
          slot: 'n2',
          transform: 'translate(-50%,-50%) translateY(calc(-10px * var(--cross-scale, 1)))'
        },
        appliedAt: new Date().toISOString(),
        method: 'date-sum-v2'
      };
      programmeStore.setItem(`canonicalRedCross-${programmeDateIso}`, JSON.stringify(savedPayload));
      programmeStore.setItem('canonicalRedCross', JSON.stringify(savedPayload));
      programmeStore.setItem('lockDisplayedCross', 'true');
    } catch(e){}

    // NEW: if the programme date is a Monday, always persist a special Monday-canonical
    // so the design is "reserved" for Mondays and cannot be changed by later scans.
    try {
      if (programmeDate && programmeDate.getDay && programmeDate.getDay() === 1) {
        const mondayKey = 'canonicalRedCross-MONDAY';
        const mondayPayload = {
          meta: (payload && payload.meta) ? payload.meta : computeTodayTermAndRemoved(programmeDate).term,
          numbers: finalAssignment.slice(0,8).map(n => String(n)),
          positions: (function(){ try { return JSON.parse(programmeStore.getItem(`redCrossPositions-${programmeDate.toISOString().slice(0,10)}`))?.positions || null; } catch(e){ return null; } })(),
          appliedAt: new Date().toISOString(),
          reserved: true
        };
        // always overwrite to ensure the reserved Monday design is up-to-date for that Monday
        programmeStore.setItem(mondayKey, JSON.stringify(mondayPayload));
        // also keep a latest pointer for lookup
        programmeStore.setItem('canonicalRedCross-MONDAY-LATEST', JSON.stringify({ date: programmeDate.toISOString().slice(0,10), savedAt: new Date().toISOString() }));
        // mark positions locked for Monday as well
        try { programmeStore.setItem('lockDisplayedCross-MONDAY', 'true'); } catch(_) {}
      }
    } catch(e) { console.warn('Failed to persist Monday canonical cross', e); }
    
    // NEW: if the programme date is a Sunday, persist this design for every Sunday of the same month
    try {
      if (programmeDate && programmeDate.getDay && programmeDate.getDay() === 0) {
        // get year/month
        const year = programmeDate.getFullYear();
        const month = programmeDate.getMonth();
        // helper to format ISO date
        const isoFor = d => d.toISOString().slice(0,10);
        // collect metadata and positions once
        const sundayMeta = { meta: (payload && payload.meta) ? payload.meta : computeTodayTermAndRemoved(programmeDate).term };
        const numbersToSave = finalAssignment.slice(0,8).map(n => String(n));
        const positionsToSave = (function(){
          try {
            const nums = Array.from(document.querySelectorAll('#redCross .cross-numbers .num')).slice(0,8);
            return nums.map(el => ({
              text: (el.textContent||'').trim(),
              left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
              top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50,
              fontSize: (el.style.fontSize || getComputedStyle(el).fontSize || null)
            }));
          } catch(e){ return null; }
        })();

        // iterate each day of month, find Sundays and persist per-Sunday canonical entry
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const dt = new Date(year, month, d);
          if (dt.getDay() !== 0) continue; // only Sundays
          try {
            const iso = isoFor(dt);
            const keyBase = `canonicalRedCross-SUNDAY-${iso}`;
            const sundayPayload = {
              meta: sundayMeta.meta,
              numbers: numbersToSave,
              positions: positionsToSave,
              appliedAt: new Date().toISOString(),
              reservedFor: 'SUNDAY',
              date: iso
            };
            // store metadata and positions
            try { programmeStore.setItem(keyBase, JSON.stringify(sundayPayload)); } catch(e){}
            // also keep a month-wide index pointer for quick lookup
            try {
              const monthIndexKey = `canonicalRedCross-SUNDAY-Month-${year}-${String(month+1).padStart(2,'0')}`;
              const existing = JSON.parse(programmeStore.getItem(monthIndexKey) || '[]');
              const entry = { date: iso, savedAt: new Date().toISOString(), key: keyBase };
              // avoid duplicates
              if (!existing.find(x => x.date === iso)) {
                existing.push(entry);
                programmeStore.setItem(monthIndexKey, JSON.stringify(existing));
              }
            } catch(e){}
            // attempt to cache a PNG snapshot in caches for the specific sunday key (best-effort)
            (async function cacheSundayImage() {
              try {
                if (typeof html2canvas !== 'undefined') {
                  const rcEl = document.getElementById('redCross');
                  if (!rcEl) return;
                  const canvas = await html2canvas(rcEl, { backgroundColor: null, scale: Math.min(2, window.devicePixelRatio || 1) });
                  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
                  if (blob && 'caches' in window) {
                    const cache = await caches.open('lotto-cache-v1');
                    const response = new Response(blob, { headers: { 'Content-Type': 'image/png' } });
                    const filename = `/croix-canonical-SUNDAY-${iso}.png`;
                    await cache.put(filename, response.clone());
                    try { programmeStore.setItem(keyBase + '-cachedUrl', filename); } catch(e){}
                  }
                }
              } catch(e){ /* non-fatal */ }
            })();
          } catch (e) {
            console.warn('Failed to persist Sunday canonical for date', dt, e);
          }
        }
        // mark month-level lock to indicate all Sundays this month are reserved
        try { programmeStore.setItem(`lockDisplayedCross-SUNDAY-Month-${year}-${String(month+1).padStart(2,'0')}`, 'true'); } catch(_) {}
      }
    } catch(e) { console.warn('Failed to persist Sunday canonical crosses for month', e); }
    
    // --- persist a high-quality PNG snapshot + metadata for Mondays so the exact image, colors and positions are remembered ---
    try {
      if (programmeDate && programmeDate.getDay && programmeDate.getDay() === 1) {
        (async () => {
          try {
            const isoDate = programmeDate.toISOString().slice(0,10); // YYYY-MM-DD
            const keyBase = `canonicalRedCross-MONDAY-${isoDate}`;
            // collect metadata: background color, buttons color, positions, numbers
            const rc = document.getElementById('redCross');
            const meta = {
              date: isoDate,
              savedAt: new Date().toISOString(),
              bg: rc ? (getComputedStyle(rc).backgroundColor || null) : null,
              cssBgVar: (function(){ try { return getComputedStyle(document.documentElement).getPropertyValue('--redCross-bg') || null; } catch(e){ return null; } })(),
              numbers: finalAssignment.slice(0,8).map(n => String(n)),
              positions: (function(){
                try {
                  const nums = Array.from(document.querySelectorAll('#redCross .cross-numbers .num')).slice(0,8);
                  return nums.map(el => ({
                    text: (el.textContent||'').trim(),
                    left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
                    top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50,
                    fontSize: (getComputedStyle(el).fontSize || null)
                  }));
                } catch(e){ return null; }
              })()
            };
            // store metadata locally
            try { programmeStore.setItem(keyBase + '-meta', JSON.stringify(meta)); } catch(e){}

            // preferred: export an in-page PNG via html2canvas if available (high-res export)
            let exportedBlob = null;
            if (typeof html2canvas !== 'undefined' && rc) {
              try {
                const scale = Math.min(2, window.devicePixelRatio || 1);
                const canvas = await html2canvas(rc, { backgroundColor: null, scale });
                exportedBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
              } catch (err) {
                exportedBlob = null;
              }
            }

            // fallback: try to fetch an existing canonical PNG asset already shipped with the site
            if (!exportedBlob) {
              try {
                const fallbackUrl = '/src/shared/images/redCross-610x601.png';
                const resp = await fetch(fallbackUrl, { cache: 'no-store' });
                if (resp && resp.ok) exportedBlob = await resp.blob();
              } catch (e) { /* ignore */ }
            }

            // If we have a blob, store it to the cache under a Monday-specific key (so it can be served as canonical)
            if (exportedBlob && 'caches' in window) {
              try {
                const cache = await caches.open('lotto-cache-v1');
                const filename = `/croix-canonical-MONDAY-${isoDate}.png`;
                const response = new Response(exportedBlob, { headers: { 'Content-Type': 'image/png' } });
                await cache.put(filename, response.clone());
                // also keep a pointer in the current page session
                try { programmeStore.setItem(keyBase + '-cachedUrl', filename); } catch(e){}
                // also store a public pointer as '/src/shared/images/croix-canonical.png' for compatibility (overwrite only for today's Monday)
                try {
                  const todayIso = new Date().toISOString().slice(0,10);
                  if (isoDate === todayIso) {
                    await cache.put('/src/shared/images/croix-canonical.png', response.clone());
                  }
                } catch(e){}
              } catch (err) {
                console.warn('Failed to cache Monday canonical image', err);
              }
            } else {
              // if no blob, attempt to fetch and cache the existing remote canonical image (best-effort)
              try {
                const remote = 'https://static.wixstatic.com/media/5d0fee_c5162490a9294e549aaa3a3452a6cfde~mv2.jpg';
                const resp = await fetch(remote, { cache: 'no-store' });
                if (resp && resp.ok && 'caches' in window) {
                  const cache = await caches.open('lotto-cache-v1');
                  await cache.put(`/croix-canonical-MONDAY-${isoDate}.png`, resp.clone());
                  try { programmeStore.setItem(keyBase + '-cachedUrl', `/croix-canonical-MONDAY-${isoDate}.png`); } catch(e){}
                }
              } catch (e) { /* ignore */ }
            }
          } catch (e) {
            console.warn('Saving Monday canonical assets failed', e);
          }
        })();
      }
    } catch(e) {
      console.warn('Monday canonical save outer failed', e);
    }
    
    // NEW: same persistent reservation for TUESDAY so the cross design + positions are memorized for all Tuesdays
    try {
      if (programmeDate && programmeDate.getDay && programmeDate.getDay() === 2) {
        const tuesdayKey = 'canonicalRedCross-TUESDAY';
        const tuesdayPayload = {
          meta: (payload && payload.meta) ? payload.meta : computeTodayTermAndRemoved(programmeDate).term,
          numbers: finalAssignment.slice(0,8).map(n => String(n)),
          positions: (function(){ try { return JSON.parse(programmeStore.getItem(`redCrossPositions-${programmeDate.toISOString().slice(0,10)}`))?.positions || null; } catch(e){ return null; } })(),
          appliedAt: new Date().toISOString(),
          reserved: true
        };
        programmeStore.setItem(tuesdayKey, JSON.stringify(tuesdayPayload));
        programmeStore.setItem('canonicalRedCross-TUESDAY-LATEST', JSON.stringify({ date: programmeDate.toISOString().slice(0,10), savedAt: new Date().toISOString() }));
        try { programmeStore.setItem('lockDisplayedCross-TUESDAY', 'true'); } catch(_) {}
      }
    } catch(e) { console.warn('Failed to persist Tuesday canonical cross', e); }

    // micro-adjust vertical offsets for digits 0/3 to match previous visuals
    numsEls.forEach(el => {
      if (!el) return;
      const t = el.textContent.trim();
      if (t === '0' || t === '3') {
        const prev = el.style.transform || getComputedStyle(el).transform || '';
        el.style.transform = (prev + ' translateY(6px)').trim();
      }
    });

    // NEW: attempt to apply any persisted canonical positions so positions become immutable.
    try {
      // prefer latest canonical positions first
      const latest = programmeStore.getItem('redCrossPositionsLatest');
      let canonicalPositions = null;
      if (latest) {
        try { canonicalPositions = JSON.parse(latest).positions || null; } catch(e){ canonicalPositions = null; }
      }
      // NEW: if today is Tuesday and there is a Tuesday-specific canonical saved, prefer it
      try {
        const { programmeDate } = computeTodayTermAndRemoved();
        if (programmeDate && programmeDate.getDay && programmeDate.getDay() === 2) {
          const tkey = `canonicalRedCross-TUESDAY`;
          const traw = programmeStore.getItem(tkey);
          if (traw) {
            const tdata = JSON.parse(traw);
            if (Array.isArray(tdata.positions) && tdata.positions.length >= 8) canonicalPositions = tdata.positions;
            else if (Array.isArray(tdata.numbers)) {
              // if positions not present but numbers saved, attempt to load date-specific positions fallback
              const fallback = programmeStore.getItem('redCrossPositionsLatest');
              if (fallback) canonicalPositions = JSON.parse(fallback).positions || canonicalPositions;
            }
          }
        }
      } catch(e){}
      // fallback: try programme-specific key if payload contains programmeDate or targetDate
      if (!canonicalPositions && payload && payload.meta) {
        const pd = payload.meta.programmeDate || payload.meta.targetDate || payload.meta.savedAt;
        if (pd) {
          let iso = pd;
          if (/^\d{2}-\d{2}-\d{4}$/.test(pd)) {
            const [dd,mm,yyyy] = pd.split('-'); iso = `${yyyy}-${mm}-${dd}`;
          }
          try {
            const keyDate = new Date(iso).toISOString().slice(0,10);
            const key = `redCrossPositions-${keyDate}`;
            const raw = programmeStore.getItem(key);
            if (raw) canonicalPositions = JSON.parse(raw).positions || canonicalPositions;
          } catch(e){}
        }
      }
      // If we have canonical positions, enforce them and do NOT reassign numbers or allow position changes.
      if (Array.isArray(canonicalPositions) && canonicalPositions.length >= 8) {
        const nums = Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0,8);
        canonicalPositions.slice(0,8).forEach((p,i) => {
          const el = nums[i];
          if (!el) return;
          // Apply fixed absolute positions only. Digit text is date-derived
          // and must never be restored from an older position snapshot.
          try {
            el.style.setProperty('left', (String(p.left) + '%'), 'important');
            el.style.setProperty('top', (String(p.top) + '%'), 'important');
            el.style.setProperty('transform', crossNumberTransform(el),'important');
            // freeze interaction and size so positions remain fixed
            el.style.setProperty('pointer-events','none','important');
            el.style.setProperty('user-select','none','important');
            el.style.setProperty('touch-action','manipulation','important');
          } catch(e){}
        });
        // mark DOM that positions are locked
        rc.dataset.positionsLocked = 'true';
      }
    } catch(e) { console.warn('Applying canonical positions failed', e); }

    // Keep both visible termination labels synchronized with the
    // parenthesized method; the date target only controls number placement.
    {
      const termEl = rc.querySelector('.term-paren');
      const termTitle = rc.querySelector('.term-title');
      if (termEl) termEl.textContent = computed.term;
      if (termTitle) termTitle.textContent = `Terminaison ${computed.terminaison}`;
    }

    // === Ensure all visible inscriptions on the cross are applied and accessible ===
    try {
      const rightLabelEl = rc.querySelector('.right-label');
      if (rightLabelEl) {
        rightLabelEl.textContent = payload?.meta?.rightLabel || 'Croix nationale';
        rightLabelEl.setAttribute('aria-hidden','false');
      }
      const sundayBtn = rc.querySelector('.sunday-button');
      if (sundayBtn) {
        // give priority to explicit meta text, else use strong "NATIONALE"
        const nationalLabel = (payload && payload.meta && payload.meta.nationalLabel)
          ? payload.meta.nationalLabel.toUpperCase()
          : 'NATIONALE';
        sundayBtn.textContent = uiText(nationalLabel);
        sundayBtn.setAttribute('aria-label', sundayBtn.textContent);
        sundayBtn.classList.add('show');
      }
    } catch(e){}

    // persist last applied programme date to avoid re-applying identical payload repeatedly
    try {
      if (programmeDate && !Number.isNaN(programmeDate.getTime())) {
        const iso = programmeDate.toISOString().slice(0,10);
        programmeStore.setItem('redCrossLastApplied', iso);
      }
    } catch(_) {}

    // NEW: Ensure Sunday styling enforced after all other adjustments so it cannot be overridden by CSS rules
    try {
      const rcFinal = document.getElementById('redCross');
      const programmeDay = programmeDate || computeTodayTermAndRemoved().programmeDate || new Date();
      if (rcFinal && programmeDay.getDay && programmeDay.getDay() === 0) {
        // force yellow background and black text/lines/buttons with !important inline styles
        rcFinal.style.setProperty('background', '#FFD700', 'important');
        // numbers, date, terminaison, footer, right-label
        rcFinal.querySelectorAll('.cross-numbers .num, #redCrossDate, .term-title, .term-paren, .right-label, .redCrossFooter').forEach(el => {
          try {
            const isDigit = el.matches('.cross-numbers .num');
            el.style.setProperty('color', '#000000', 'important');
            el.style.setProperty('-webkit-text-fill-color', '#000000', 'important');
            el.style.setProperty('fill', '#000000', 'important');
            el.style.setProperty(
              '-webkit-text-stroke',
              isDigit ? '1.45px #000000' : '0px',
              'important'
            );
            el.style.setProperty(
              'text-stroke',
              isDigit ? '1.45px #000000' : '0px',
              'important'
            );
            el.style.setProperty(
              'text-shadow',
              isDigit
                ? '.45px 0 #000000, -.45px 0 #000000, 0 .45px #000000, 0 -.45px #000000'
                : 'none',
              'important'
            );
            el.style.setProperty('filter', 'none', 'important');
          } catch(e){}
        });
        // SVG cross lines
        rcFinal.querySelectorAll('svg .cross-line').forEach(line => {
          try { line.style.setProperty('stroke', '#000000', 'important'); line.setAttribute('stroke', '#000000'); } catch(e){}
        });
        // buttons (ensure high contrast)
        rcFinal.querySelectorAll('.black-square-btn, .sunday-button').forEach(b => {
          try {
            b.style.setProperty('background', '#ffffff', 'important');
            b.style.setProperty('color', '#000000', 'important');
            b.style.setProperty('border-color', 'rgba(0,0,0,0.06)', 'important');
          } catch(e){}
        });
      }
    } catch(e){}

    // Final enforcement: keep the NATIONALE label readable against the
    // current day's colour (black on Sunday yellow, white otherwise).
    rc.querySelectorAll('.sunday-button').forEach(b => {
      try {
        b.style.setProperty('background', dayColor, 'important');
        b.style.setProperty('color', textColor, 'important');
        b.style.setProperty('-webkit-text-fill-color', textColor, 'important');
      } catch(e){}
    });

    // Keep the footer aligned with the canonical ink. In particular, Sunday
    // uses black ink on the light/yellow cross; a legacy white override here
    // used to undo the Sunday contrast pass above.
    try {
      rc.querySelectorAll('.redCrossFooter').forEach(el => {
        el.style.setProperty('color', textColor, 'important');
        el.style.setProperty('-webkit-text-fill-color', textColor, 'important');
      });
      if (clone) {
        clone.querySelectorAll('.redCrossFooter').forEach(el => {
          el.style.setProperty('color', textColor, 'important');
          el.style.setProperty('-webkit-text-fill-color', textColor, 'important');
        });
      }
    } catch(e){}

    // One final pass removes legacy inline palette writes and hands the
    // complete colour state to the cross section of /src/styles/app.css. Positions, transforms,
    // sizes and all textual content remain untouched.
    applyCanonicalCrossColors(dayColor, textColor, w);

    // The live component is now canonical. Mark it ready only after all
    // server data, colors and locked positions have been applied, so the
    // old static HTML can never flash before the official render.
    try {
      saveOfficialCrossSnapshot(computed, finalAssignment, {
        // Rendering a cached row must never refresh its verification age.
        verifiedAt: payload?.meta?.cachedOfficial ? null : new Date().toISOString()
      });
      rc.dataset.crossReady = 'true';
      rc.setAttribute('aria-hidden', 'false');
      window.dispatchEvent(new CustomEvent('cid:cross-ready', {
        detail: {
          programmeDate: programmeIso(computed.programmeDate),
          assignment: finalAssignment.slice(0, 8).map(String),
          cached: Boolean(payload?.meta?.cachedOfficial)
        }
      }));
    } catch (_) {}

  } catch (e) {
    console.warn('redCrossService.applyPayload error', e);
  }
}

// NEW: allow manual memorization of the current on-screen cross as the canonical Tuesday design
export function memorizeTuesdayDesign() {
  try {
    const rc = document.getElementById('redCross');
    if (!rc) return false;
    const nums = Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0,8).map(el => ({
      text: (el.textContent||'').trim(),
      left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
      top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50
    }));
    const programmeDate = computeTodayTermAndRemoved().programmeDate;
    const dateIso = programmeDate && !Number.isNaN(programmeDate.getTime()) ? programmeDate.toISOString().slice(0,10) : (new Date()).toISOString().slice(0,10);
    const payload = { meta: { savedAt: new Date().toISOString(), programmeDate: dateIso }, positions: nums, numbers: nums.map(n=>n.text) };
    programmeStore.setItem('canonicalRedCross-TUESDAY', JSON.stringify(payload));
    programmeStore.setItem('canonicalRedCross-TUESDAY-LATEST', JSON.stringify({ date: dateIso, savedAt: new Date().toISOString() }));
    programmeStore.setItem('lockDisplayedCross-TUESDAY', 'true');
    return true;
  } catch (e) { console.warn('memorizeTuesdayDesign failed', e); return false; }
}

// NEW: allow manual memorization of the current on-screen cross as the canonical Monday design
export async function memorizeMondayDesign() {
  try {
    const rc = document.getElementById('redCross');
    if (!rc) return false;
    const nums = Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0,8).map(el => ({
      text: (el.textContent||'').trim(),
      left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
      top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50,
      fontSize: el.style.fontSize || getComputedStyle(el).fontSize || null
    }));
    const programmeDate = computeTodayTermAndRemoved().programmeDate;
    const dateIso = programmeDate && !Number.isNaN(programmeDate.getTime()) ? programmeDate.toISOString().slice(0,10) : (new Date()).toISOString().slice(0,10);
    const payload = { meta: { savedAt: new Date().toISOString(), programmeDate: dateIso }, positions: nums, numbers: nums.map(n=>n.text) };
    // persist canonical Monday payload
    programmeStore.setItem(`canonicalRedCross-MONDAY-${dateIso}`, JSON.stringify(payload));
    programmeStore.setItem('canonicalRedCross-MONDAY-LATEST', JSON.stringify({ date: dateIso, savedAt: new Date().toISOString() }));
    programmeStore.setItem('lockDisplayedCross-MONDAY', 'true');

    // try creating and caching a high-quality PNG snapshot (best-effort)
    try {
      if (typeof html2canvas !== 'undefined') {
        const canvas = await html2canvas(rc, { backgroundColor: null, scale: Math.min(2, window.devicePixelRatio || 1) });
        await new Promise((resolve) => {
          canvas.toBlob(async (blob) => {
            if (blob && 'caches' in window) {
              try {
                const cache = await caches.open('lotto-cache-v1');
                const filename = `/croix-canonical-MONDAY-${dateIso}.png`;
                const response = new Response(blob, { headers: { 'Content-Type': 'image/png' } });
                await cache.put(filename, response.clone());
                try { programmeStore.setItem(`canonicalRedCross-MONDAY-${dateIso}-cachedUrl`, filename); } catch(_) {}
              } catch (err) {
                console.warn('Failed to cache Monday PNG', err);
              }
            }
            resolve(true);
          }, 'image/png');
        });
      } else {
        // fallback: try to fetch an existing canonical remote image and cache it under Monday key
        try {
          const remote = '/src/shared/images/redCross-610x601.png';
          const resp = await fetch(remote, { cache: 'no-store' });
          if (resp && resp.ok && 'caches' in window) {
            const cache = await caches.open('lotto-cache-v1');
            await cache.put(`/croix-canonical-MONDAY-${dateIso}.png`, resp.clone());
            try { programmeStore.setItem(`canonicalRedCross-MONDAY-${dateIso}-cachedUrl`, `/croix-canonical-MONDAY-${dateIso}.png`); } catch(_) {}
          }
        } catch(e){}
      }
    } catch (exportErr) { console.warn('export Monday image failed', exportErr); }

    return true;
  } catch (e) { console.warn('memorizeMondayDesign failed', e); return false; }
}

// Poll the protected Edge Function so the page stays current.
const INTERVAL = 300000;
let recordedCoreDate = '';

async function fetchAndApplyOnce({ force = false, date = null } = {}){
  try {
    // The Anticipé route fetches and paints its own future publication.
    // Background polling for Accueil must remain completely inert there.
    if (isAnticipationSurface()) return false;
    // Paint the last validated database row first. This is deliberately
    // allowed offline; it is never used to calculate or replace a programme.
    const requestedDate = date || getRequestedCrossDate();
    const cacheDate = programmeIso(requestedDate || getProgrammeDate(new Date()));
    const cachedRecord = readOfficialCrossRecord(cacheDate);
    if (cachedRecord) {
      const cachedPayload = officialRecordPayload(cachedRecord, true);
      if (cachedPayload) applyPayload(cachedPayload);
    }

    // A normal revisit with a fresh current-programme row is entirely local.
    // Do this before the access refresh as well: the access gate is needed for
    // a new/selected programme, but must not turn every reload into a remote
    // request when the official result is already cached.
    const currentProgrammeDate = programmeIso(getProgrammeDate(new Date()));
    // A stored row for today or any past date is the final publication for
    // that date: a new publication always arrives under a new programme
    // date, so no database request is needed until the date changes.
    if (!force
      && cachedRecord
      && cacheDate
      && currentProgrammeDate
      && cacheDate <= currentProgrammeDate) {
      return true;
    }

    const earlyAccessAllowed = await window.cidEarlyAccessUi?.canRead?.(
      'croix',
      cacheDate
    );
    if (earlyAccessAllowed === false) {
      console.info('Croix nationale en attente de son accès anticipé ou de 16h.');
      return false;
    }
    if (cachedRecord) {
      if (!force && (!navigator.onLine || isOfficialCacheFresh(cachedRecord))) {
        return true;
      }
    } else if (navigator.onLine === false) {
      console.warn('Croix nationale indisponible hors connexion et absente du cache local.');
      return false;
    }

    // Supabase is the only source for the programme and its calculation.
    // A stale cache is reconciled here; a fresh cache avoids another read.
    const serverRecord = await requestServerCross(requestedDate, 'year');
    if (serverRecord) {
      const serverPayload = {
        meta: {
          term: serverRecord.term,
          removedDigits: serverRecord.removedDigits,
          programmeDate: serverRecord.programmeDate,
          targetDate: serverRecord.programmeDate,
          assignment: serverRecord.assignment,
          crossNumbers: serverRecord.assignment,
          dateSum: serverRecord.dateSum,
          dateDigitSum: serverRecord.dateDigitSum,
          dateFinishingDigit: serverRecord.dateFinishingDigit,
          dateFinishing: serverRecord.dateFinishing,
          terminaison: serverRecord.terminaison,
          crossLineGroups: serverRecord.alignments,
          signature: serverRecord.signature,
          serverGenerated: serverRecord.persisted !== false,
          supabaseSource: true,
          persisted: serverRecord.persisted !== false
        },
        results: []
      };
      writeOfficialCrossRecord({
        ...serverRecord,
        savedAt: new Date().toISOString()
      }, { verifiedAt: new Date().toISOString() });
      try { programmeStore.setItem('crossServerPayload', JSON.stringify(serverPayload)); } catch (_) {}
      applyPayload(serverPayload);
      const serverDate = String(serverRecord.programmeDate || '').slice(0, 10);
      if (serverDate && recordedCoreDate !== serverDate) {
        recordedCoreDate = serverDate;
        recordCoreCalculation('croix-nationale', serverDate, serverPayload.meta).catch(() => {});
      }
      return true;
    }

    // Never calculate or reconstruct a programme in the browser when the
    // protected function is unavailable. Keep a useful cached render if one
    // was available.
    console.warn('Programme Croix nationale indisponible côté serveur.');
    return Boolean(cachedRecord);

  } catch (err) {
    console.warn('fetchAndApply top-level error', err);
    return Boolean(readOfficialCrossRecord(
      getRequestedCrossDate() || getProgrammeDate(new Date())
    ));
  }
}

// Several legacy startup paths ask for the official Croix at the same time.
// Share one promise per programme date so a reload performs one
// server/database request without letting dates compete with one another.
async function fetchAndApply({ force = false, date = null } = {}){
  const explicitDate = date ? parseCrossDate(date) : null;
  const requestedDate = explicitDate || getRequestedCrossDate();
  const requestKey = programmeIso(requestedDate) || `current:${programmeIso(getProgrammeDate(new Date()))}`;
  if (!force && requestKey === lastSuccessfulRequestKey &&
      Date.now() - lastSuccessfulRequestAt < REQUEST_DEDUPE_WINDOW) {
    return true;
  }
  const pending = fetchInFlight.get(requestKey);
  if (pending) return pending;

  const request = fetchAndApplyOnce({
    force,
    date: requestedDate
  }).then((success) => {
    if (success) {
      lastSuccessfulRequestKey = requestKey;
      lastSuccessfulRequestAt = Date.now();
    }
    return success;
  }).finally(() => {
    if (fetchInFlight.get(requestKey) === request) {
      fetchInFlight.delete(requestKey);
    }
  });
  fetchInFlight.set(requestKey, request);
  return request;
}

window.addEventListener('cid:language-change', () => {
  // Only labels are localized; the published numbers come from the local
  // row, so a language switch must not trigger another database read.
  refreshCrossLocalizedLabels();
  fetchAndApply().catch(() => {});
});

// expose public API for legacy callers
window.updateRedCrossFromState = window.updateRedCrossFromState || function(payload){ try { applyPayload(payload); } catch(e){ console.warn(e); } };
window.updateRedCrossForDate = window.updateRedCrossForDate || async function(isoDate){
  const d = parseCrossDate(isoDate);
  if (!d) return;
  // Date selection only changes the request sent to the protected function.
  // The browser never derives the term, removed digits, or assignment.
  programmeState.selectedDate = String(isoDate).slice(0, 10);
  applyCrossDayStyle(
    document.getElementById('redCross'),
    programmeState.selectedDate
  );
  // "Voir" on an archive date paints the stored row instantly; the
  // database is contacted only when that date is not on the device yet.
  await fetchAndApply({
    date: programmeState.selectedDate
  });
};

// initialize: apply stored lottoState if present then start polling
(function init(){
  try {
    const saved = programmeStore.getItem('lottoState');
    if (saved) {
      const parsed = JSON.parse(saved);
      const meta = { drawNumber: parsed.drawNumber, savedAt: new Date().toISOString() };
      if (Array.isArray(parsed.results) && parsed.results.length && parsed.results[0].date) {
        const parts = parsed.results[0].date.split('-');
        meta.targetDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : undefined;
      }
      const payload = { meta, results: parsed.results || [] };
      applyPayload(payload);
    }
  } catch(e){}
  // NEW: ensure Tuesday canonical cross is applied immediately on init if today is Tuesday
  try {
    const now = new Date();
    if (now.getDay && now.getDay() === 2) {
      const tkey = 'canonicalRedCross-TUESDAY';
      const traw = programmeStore.getItem(tkey);
      if (traw) {
        try { const tp = JSON.parse(traw); applyPayload({ meta: tp.meta || {}, results: [] }); } catch(e){}
      }
    }
  } catch(e){}
  // Paint the last official same-day result immediately. Only contact the
  // server during startup when there is no cached row or when it is stale;
  // the normal background interval reconciles a stale row, not every render.
  let restored = false;
  try { restored = restoreOfficialCrossSnapshot(); } catch (_) {}
  let cacheAge = Infinity;
  try {
    const currentDate = programmeIso(getProgrammeDate(new Date()));
    const cached = readOfficialCrossRecord(currentDate);
    const raw = localStorage.getItem(`${CROSS_SNAPSHOT_PREFIX}${currentDate}`)
      || localStorage.getItem(CROSS_SNAPSHOT_KEY);
    const savedAt = Date.parse(cached?.verifiedAt || cached?.savedAt
      || (raw ? JSON.parse(raw).savedAt : ''));
    cacheAge = Number.isFinite(savedAt) ? Date.now() - savedAt : Infinity;
  } catch (_) {}
  let hasCurrentRow = false;
  try {
    hasCurrentRow = Boolean(readOfficialCrossRecord(
      programmeIso(getProgrammeDate(new Date()))
    ));
  } catch (_) {}
  if (!hasCurrentRow && (!restored || cacheAge > CROSS_CACHE_FRESH_MS)) {
    setTimeout(fetchAndApply, 800);
  } else if (hasCurrentRow) {
    // Paint the stored publication without contacting the database.
    setTimeout(() => { fetchAndApply().catch(() => {}); }, 0);
  }
  setInterval(fetchAndApply, INTERVAL);
  window.addEventListener('online', () => {
    // Fetch only what is still missing locally when connectivity returns.
    fetchAndApply().catch(() => {});
  });
  // The Supabase SDK may attach after reconnection (offline start).
  window.addEventListener('cid:supabase-ready', () => {
    fetchAndApply().catch(() => {});
  });

  // persist Friday canonical image into cache as /src/shared/images/croix-canonical.png
  try {
    const { programmeDate } = computeTodayTermAndRemoved();
    if (programmeDate && programmeDate.getDay() === 5 && 'caches' in window) {
      (async () => {
        try {
          // fetch the user-provided Wix canonical image and cache it under /src/shared/images/croix-canonical.png for compatibility
          const CANONICAL_URL = 'https://static.wixstatic.com/media/5d0fee_c5162490a9294e549aaa3a3452a6cfde~mv2.jpg';
          const resp = await fetch(CANONICAL_URL, { cache: 'no-store' });
          if (!resp.ok) return;
          const cache = await caches.open('lotto-cache-v1');
          // cache it at the same pathname so existing consumers can continue to request /src/shared/images/croix-canonical.png
          await cache.put('/src/shared/images/croix-canonical.png', resp.clone());
        } catch (err) { console.warn('Failed to cache Friday canonical image', err); }
      })();
    }
  } catch(e){}

  // NEW: if today is Monday, memorize the current on-screen cross as the permanent Monday canonical (best-effort)
  try {
    const today = computeTodayTermAndRemoved().programmeDate;
    if (today && today.getDay && today.getDay() === 1) {
      // call memorizeMondayDesign but do not block init
      try { memorizeMondayDesign().catch ? memorizeMondayDesign().catch(()=>{}) : setTimeout(()=>{ memorizeMondayDesign(); }, 50); } catch(_) {}
    }
  } catch(e){}
})();

export default {
  computeTodayTermAndRemoved,
  applyPayload,
  fetchAndApply
};

export { fetchAndApply };
