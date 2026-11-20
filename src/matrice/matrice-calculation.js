/*
 * Matrice client adapter.
 *
 * The calculation itself lives in the Supabase Edge Function
 * `smart-function`. This file only invokes that function and exposes the
 * response to the existing display/controllers.
 */

let generatedResults = null;
let drawNumber = null;
let archive = [];
let requestPromise = null;
let requestProgrammeDate = '';
let requestSequence = 0;
let lastProgrammeDate = null;
let lastMatrixRefreshAt = 0;
const MATRIX_FUNCTION_NAME = 'smart-function';

try {
  Object.defineProperty(window, 'generatedResults', {
    configurable: true,
    get: () => generatedResults,
    set: (value) => {
      generatedResults = Array.isArray(value) ? value : null;
    }
  });
} catch (error) {
  console.warn('Unable to expose generatedResults bridge', error);
}

Object.defineProperty(window, 'drawNumber', {
  configurable: true,
  get: () => drawNumber,
  set: (value) => {
    if (value === null || value === undefined || String(value).trim() === '') {
      drawNumber = null;
      return;
    }
    const numericValue = Number(value);
    if (Number.isSafeInteger(numericValue)) drawNumber = numericValue;
  }
});

window.archive = archive;
window.__suppressRegenerationOnMatrice = false;

function getSupabase() {
  return Promise.resolve(window.cidSupabaseReady).then((bridge) => {
    const supabase = bridge?.client;
    if (!supabase?.functions?.invoke) {
      throw new Error('Supabase n’est pas configuré pour lire la matrice.');
    }
    return supabase;
  });
}

function getProgrammeDate(now = new Date()) {
  const anticipationActive = document.body.classList.contains('anticipation-active')
    || document.body.dataset.cidDedicatedView === 'anticipe'
    || window.__currentCategory === 'anticipe';
  const anticipated = anticipationActive
    ? window.cidEarlyAccessUi?.programmeDateFor?.('matrice')
    : null;
  if (anticipated) return anticipated;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + (Number(parts.hour) >= 16 ? 1 : 0)
  ));
  return date.toISOString().slice(0, 10);
}

function formatDateForDisplay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Africa/Abidjan'
  });
}

function canonicalMatrixCountry(value) {
  const raw = String(value || '').trim();
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const aliases = {
    benin: 'Bénin',
    'cote d ivoire': "Côte d'Ivoire",
    'ivory coast': "Côte d'Ivoire",
    ghana: 'Ghana',
    niger: 'Niger',
    senegal: 'Sénégal',
    togo: 'Togo'
  };
  return aliases[key] || raw;
}

function maskFrontendMatrixName(value) {
  return String(value || '')
    .replace(/\bSA\b/gi, '')
    .replace(/\bSoudji\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeMatrixResults(results) {
  return (Array.isArray(results) ? results : []).map((item) => {
    const country = canonicalMatrixCountry(item?.country);
    const normalizedBase = country && country !== item?.country
      ? { ...item, country }
      : item;
    const normalized = {
      ...normalizedBase,
      ...(normalizedBase?.name
        ? { name: maskFrontendMatrixName(normalizedBase.name) }
        : {}),
      ...(country === 'Niger'
        ? { hour: 14, draw_time: '14:00' }
        : {})
    };
    return normalized;
  });
}

function applyResponse(payload) {
  const results = normalizeMatrixResults(payload?.results);
  const meta = payload?.meta || {};
  generatedResults = results;
  lastProgrammeDate = meta.programmeDate || results[0]?.date || null;

  const explicitDrawNumber = Number(meta.drawNumber);
  drawNumber = Number.isSafeInteger(explicitDrawNumber) && explicitDrawNumber >= 0
    ? explicitDrawNumber
    : null;
  window.archive = archive;
  window.cidProgrammeState = window.cidProgrammeState || {};
  window.cidProgrammeState.lottoState = {
    results,
    drawNumber,
    archive,
    meta
  };

  const nextDay = document.getElementById('nextDay');
  if (nextDay && meta.programmeDate) {
    nextDay.textContent = `Résultats pour : ${formatDateForDisplay(meta.programmeDate)}`;
  }
  const drawElement = document.getElementById('drawNumber');
  if (drawElement) {
    const hasDrawNumber = Number.isSafeInteger(drawNumber) && drawNumber >= 0;
    drawElement.textContent = hasDrawNumber
      ? `Numéro de tirage : ${drawNumber}`
      : '';
    drawElement.hidden = !hasDrawNumber;
    drawElement.style.display = hasDrawNumber ? '' : 'none';
  }

  return results;
}

function matrixCacheIdentity() {
  return String(window.cidAuthCurrentUserId || 'visitor').trim() || 'visitor';
}

function hydrateMatrixCache(programmeDate) {
  const stored = window.cidPersistentCache?.read?.(
    `matrix-programmes:${programmeDate}`,
    matrixCacheIdentity(),
    // A programme is final for its date: the key already changes with each
    // new publication, so the stored copy never expires on its own.
    Infinity
  );
  if (!stored?.value || !Array.isArray(stored.value.results)
    || !stored.value.results.length) return null;
  const results = applyResponse({
    results: stored.value.results,
    meta: {
      // Older cache entries carried the legacy client-side default (2710).
      // It was never user-entered, so cached data must not resurrect it.
      ...(stored.value.meta || {}),
      drawNumber: stored.value.meta?.drawNumberExplicit === true
        ? stored.value.meta.drawNumber
        : null,
      programmeDate
    }
  });
  return results;
}

async function invokeCalculateMatrix(options = {}) {
  const programmeDate = options.programmeDate || getProgrammeDate();
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke(MATRIX_FUNCTION_NAME, {
    body: {
      programmeDate,
      drawNumber
    }
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.results)) {
    throw new Error(data?.error || 'La fonction smart-function n’a pas retourné de résultats.');
  }
  return {
    ...data,
    results: normalizeMatrixResults(data.results)
  };
}

function startMatrixRequest(programmeDate, identity) {
  const requestedDate = String(programmeDate || '').slice(0, 10);
  if (requestPromise && requestProgrammeDate === requestedDate) return requestPromise;
  const sequence = ++requestSequence;
  requestProgrammeDate = requestedDate;
  lastMatrixRefreshAt = Date.now();
  requestPromise = invokeCalculateMatrix({ programmeDate: requestedDate })
    .then((payload) => {
      const results = Array.isArray(payload?.results)
        ? payload.results
        : [];
      /*
       * A slower response for a previous date may finish after the user has
       * selected another archive day. It can resolve its own caller, but it
       * must never replace the active Matrice state or cache.
       */
      if (sequence !== requestSequence) return results;
      applyResponse(payload);
      window.cidPersistentCache?.write?.(
        `matrix-programmes:${requestedDate}`,
        identity,
        {
          results,
          meta: {
            programmeDate: requestedDate,
            ...(Number.isSafeInteger(drawNumber) ? { drawNumber } : {}),
            drawNumberExplicit: Number.isSafeInteger(drawNumber),
            savedAt: new Date().toISOString()
          }
        }
      );
      try {
        if (typeof window.updateRedCrossFromState === 'function') {
        window.updateRedCrossFromState({
            meta: {
              programmeDate: requestedDate,
              ...(Number.isSafeInteger(drawNumber) ? { drawNumber } : {}),
              savedAt: new Date().toISOString()
            },
            results
          });
        }
      } catch (error) {
        console.warn('Red cross synchronisation failed', error);
      }
      return results;
    })
    .catch((error) => {
      console.warn('Matrice Supabase loading failed', error);
      throw error;
    })
    .finally(() => {
      if (sequence === requestSequence) {
        requestPromise = null;
        requestProgrammeDate = '';
      }
    });
  return requestPromise;
}

/*
 * Read a validated programme for a specific date without replacing the
 * currently mounted Matrice state. The Anticipé route uses this adapter so
 * preview data cannot leak into the normal Accueil/Matrice surface.
 */
async function fetchProgrammeForDate(programmeDate) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke(MATRIX_FUNCTION_NAME, {
    body: {
      programmeDate: String(programmeDate || '').slice(0, 10),
      drawNumber
    }
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.results)) {
    throw new Error(data?.error || 'La fonction smart-function n’a pas retourné de résultats.');
  }
  return { ...data, results: normalizeMatrixResults(data.results) };
}

async function generateLottoResults(options = {}) {
  const programmeDate = options.programmeDate || getProgrammeDate();
  const force = Boolean(options.force);
  const identity = matrixCacheIdentity();

  if (!force && !generatedResults) hydrateMatrixCache(programmeDate);
  if (!force && generatedResults && lastProgrammeDate === programmeDate) {
    // localStorage first: the day's programme is already on the device, so
    // no database call is made until the next publication (new date) or an
    // explicit forced refresh at the 16:00 boundary.
    void lastMatrixRefreshAt;
    return generatedResults;
  }
  if (requestPromise && !force) return requestPromise;
  return startMatrixRequest(programmeDate, identity);
}

function copyText(text) {
  const value = String(text || '').trim();
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  return Promise.resolve();
}

function formatProgramme(programme) {
  const lines = [
    programme.name || programme.country || 'Programme',
    programme.date || '',
    'Matrice',
    ...(Array.isArray(programme.matrix) ? programme.matrix : [])
  ];
  if (Array.isArray(programme.keyboard) && programme.keyboard.length) {
    lines.push('Clavier', ...programme.keyboard);
  }
  if (Array.isArray(programme.cerveau) && programme.cerveau.length) {
    lines.push('Cerveau', ...programme.cerveau);
  }
  lines.push(`Code: ${programme.code || ''}`, `Event: ${programme.event || ''}`);
  return lines.map(String).join('\n').trim();
}

window.generateLottoResults = generateLottoResults;
window.cidFetchProgrammeForDate = fetchProgrammeForDate;
window.updateArchiveDisplay = window.updateArchiveDisplay || (() => {});

window.copyAllResults = function copyAllResults() {
  const programmes = Array.isArray(window.__matrixCopyResults) && window.__matrixCopyResults.length
    ? window.__matrixCopyResults
    : (generatedResults || []);
  return copyText(programmes.map(formatProgramme).join('\n\n'));
};

window.copyCountryResult = function copyCountryResult(country) {
  const programmes = (generatedResults || []).filter((programme) => programme.country === country);
  return copyText(programmes.map(formatProgramme).join('\n\n'));
};

const DEFAULT_MATRIX_COUNTRY_ORDER = [
  "Côte d'Ivoire",
  'Niger',
  'Ghana',
  'Bénin',
  'Sénégal',
  'Togo'
];

function matrixCountryOptions(results = generatedResults) {
  const names = Array.isArray(results)
    ? results
      .map((programme) => String(programme?.country || '').trim())
      .filter(Boolean)
    : [];
  const present = new Set(names);
  const known = DEFAULT_MATRIX_COUNTRY_ORDER.filter(
    (country) => !names.length || present.has(country)
  );
  const additional = [...new Set(names)]
    .filter((country) => !DEFAULT_MATRIX_COUNTRY_ORDER.includes(country))
    .sort((left, right) => left.localeCompare(right, 'fr'));
  return [...known, ...additional, 'Tous'];
}

window.renderCountryButtons = function renderCountryButtons(resultsOverride = generatedResults) {
  const container = document.getElementById('countryButtons');
  if (!container) return;
  container.replaceChildren();
  const countries = matrixCountryOptions(resultsOverride);
  countries.forEach((country) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'country-filter-btn';
    button.dataset.country = country;
    button.textContent = country;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => window.selectMatriceCountry?.(country));
    container.appendChild(button);
  });
};

function refreshAtNextBoundary() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  const todayBoundary = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    16,
    0,
    0,
    0
  );
  const next = new Date(now.getTime() < todayBoundary
    ? todayBoundary
    : Date.UTC(part('year'), part('month') - 1, part('day') + 1, 16, 0, 0, 0));
  window.setTimeout(async () => {
    try {
      await generateLottoResults({ force: true });
    } finally {
      refreshAtNextBoundary();
    }
  }, Math.max(next.getTime() - now.getTime(), 1000));
}

/*
 * Bootstrap owns the initial home warm-up. Do not repeat the same request from
 * a window.load listener: on a cold PWA start that second lifecycle event can
 * arrive while the feed is being mounted and trigger a late repaint.
 */
window.cidStartMatrixBoundaryRefresh = () => {
  refreshAtNextBoundary();
};
