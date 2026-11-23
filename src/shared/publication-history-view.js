/*
 * Shared nine-day history for Matrice, Boules rejetées and Tableaux.
 *
 * Tableaux history reuses the fetched programme values and clones the
 * already-mounted official portfolio. It never calculates a replacement
 * result or invents a second visual structure in the UI.
 */
import { getProgrammeDate } from '/src/backend-server/methods/program-clock.js';
import { fetchHistoryPayload } from '/src/services/history-api.js?history-api-v1';
import {
  historyCacheKey,
  readHistoryPayload,
  writeHistoryPayload
} from '/src/shared/history-cache.js?history-cache-v40';
import {
  getPostMetrics,
  recordPostShare,
  togglePostLike
} from '/src/services/social-repository.js';
import {
  TABLEAU_DEFINITIONS,
  normalizeTableauFeatureKey,
  resolveTableauPlan
} from '/src/tableaux/tableau-contract.js?tableau-contract-v2';

(() => {
  'use strict';

  const HOST_ID = 'historyViewContainer';
  const MOUNT_ID = 'historyViewMount';
  const HISTORY_DAYS = 9;
  const TABLEAU_SELECTORS = [
    '.portfolio-universal',
    '.portfolio-intuition',
    '.portfolio-oracle',
    '.portfolio-manual',
    '.portfolio-lnb',
    '.portfolio-standby',
    '#createdProgramPortfolios'
  ].join(', ');
  const TABLEAU_KEYS = Object.freeze(Object.fromEntries([
    ...TABLEAU_DEFINITIONS.map(({ portfolioClass, featureKey }) => (
      [portfolioClass, featureKey]
    )),
    ['createdProgramPortfolios', 'tableaux-created']
  ]));
  const LABELS = Object.freeze({
    matrix: 'Matrice',
    rejected: 'Boules rejetées',
    tableaux: 'Tableaux'
  });
  const HISTORY_KEY_ZERO = '000000';
  const HISTORY_VALUE_ZERO = '00';
  const HISTORY_CROSS_ZERO = '0';

  const get = (id) => document.getElementById(id);
  let historyRequestToken = 0;
  const historyInFlight = new Map();
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function isoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + amount);
    return isoDate(date);
  }

  function dateLabel(value) {
    return new Date(`${value}T12:00:00.000Z`).toLocaleDateString(
      window.cidTranslation?.current?.() || 'fr',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Abidjan'
      }
    );
  }

  function currentProgrammeDate() {
    return isoDate(
      window.cidEarlyAccessUi?.programmeDate?.()
      || getProgrammeDate()
    );
  }

  function dates() {
    const current = currentProgrammeDate();
    return Array.from({ length: HISTORY_DAYS }, (_, index) => addDays(
      current,
      -index
    )).filter(Boolean);
  }

  function keyForTableau(root) {
    if (!root) return '';
    const className = Array.from(root.classList || [])
      .find((name) => TABLEAU_KEYS[name]);
    return TABLEAU_KEYS[className] || TABLEAU_KEYS[root.id] || '';
  }

  function labelForTableau(key) {
    if (String(key || '') === 'tableaux-created') return 'Programmes créés';
    const definition = TABLEAU_DEFINITIONS.find((item) => (
      item.featureKey === normalizeTableauFeatureKey(key)
    ));
    if (definition) return definition.label;
    return normalizeTableauFeatureKey(key)
      .replace(/^tableaux-/, '')
      .replace(/^./, (letter) => letter.toUpperCase());
  }

  function accessKey(kind, featureKey = '') {
    return kind === 'tableaux' ? featureKey : kind === 'rejected'
      ? 'boules-rejetees'
      : 'matrice';
  }

  async function hasAccess(kind, featureKey = '') {
    if (window.cidIsAdmin === true) return true;
    const key = accessKey(kind, featureKey);
    // Local snapshot first: a free (or already granted) section opens its
    // archive immediately; the network is only consulted when it says no.
    if (window.cidFeatureAccess?.has?.(key) === true) return true;
    const access = await Promise.resolve(
      window.cidFeatureAccess?.refresh?.()
    ).catch(() => null);
    return Boolean(
      window.cidFeatureAccess?.has?.(key)
      || access?.featureUnlocks?.some?.((item) => (
        String(item?.feature_key || '').toLowerCase() === key
      ))
    );
  }

  function normalizeValues(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String).join(' · ');
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
        .map(([name, entry]) => `${name}: ${Array.isArray(entry) ? entry.join(' · ') : entry}`)
        .join(' · ');
    }
    return String(value ?? '').trim();
  }

  function valueLines(value, vertical = false) {
    const splitValue = (entry) => {
      const text = String(entry).trim();
      if (!vertical) return text ? [text] : [];
      return text.split(/[\s,;·|/]+/).filter(Boolean);
    };
    if (Array.isArray(value)) {
      return value
        .flatMap((entry) => (
          entry && typeof entry === 'object'
            ? Object.values(entry)
            : [entry]
        ))
        .filter((entry) => entry !== null && entry !== undefined && String(entry).trim())
        .flatMap(splitValue);
    }
    if (value && typeof value === 'object') {
      return Object.values(value)
        .filter((entry) => entry !== null && entry !== undefined && String(entry).trim())
        .flatMap(splitValue);
    }
    return value !== null && value !== undefined ? splitValue(value) : [];
  }

  function matrixHistoryLabel(programme) {
    const rawCountry = String(programme?.country || '').trim();
    const rawName = String(programme?.name || '')
      .replace(/\bSA\b/gi, '')
      .replace(/\bSoudji\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const rawTime = String(
      programme?.draw_time || programme?.drawTime || ''
    ).trim();
    const rawHour = programme?.hour;
    const isNiger = String(rawCountry).toLocaleLowerCase('fr-FR') === 'niger';
    const numericHour = isNiger
      ? 14
      : rawHour === null
      || rawHour === undefined
      || String(rawHour).trim() === ''
      ? Number.NaN
      : Number(rawHour);
    const timeMatch = rawTime.match(/^(\d{1,2})(?::(\d{2}))?/);
    const nameTimeMatch = rawName.match(/(?:^|\s)(\d{1,2})h(?:\s*(\d{2}))?\s*$/i);
    const hour = Number.isFinite(numericHour)
      ? numericHour
      : timeMatch
        ? Number(timeMatch[1])
        : nameTimeMatch
          ? Number(nameTimeMatch[1])
          : Number.NaN;
    const minute = timeMatch?.[2] || nameTimeMatch?.[2] || '';
    const hourLabel = Number.isFinite(hour)
      ? `${String(hour).padStart(2, '0')}h${minute && minute !== '00' ? minute : ''}`
      : '';
    // Configured names often contain the exact same country and time
    // (e.g. "Bénin 00h"). The archive header is intentionally composed
    // from the canonical country/time fields only, so neither value repeats.
    const country = rawCountry
      .replace(/\s*(?:[-·•]\s*)?\d{1,2}h(?:\s*\d{2})?\s*$/i, '')
      .trim()
      || rawName
        .replace(/\s*(?:[-·•]\s*)?\d{1,2}h(?:\s*\d{2})?\s*$/i, '')
        .trim()
      || rawName
      || 'Programme';
    return [country, hourLabel].filter(Boolean).join(' • ');
  }

  function explicitDrawNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? String(numeric) : null;
  }

  function matrixHistoryFields(programme, payload) {
    const drawNumber = explicitDrawNumber(
      payload?.drawNumber ?? payload?.meta?.drawNumber
    );
    return [
      ['N° tirage', drawNumber, false],
      ['Matrice', programme?.matrix, true],
      ['Clavier', programme?.keyboard, true],
      ['Cerveau', programme?.cerveau, true],
      ['Code', programme?.code, false],
      ['Événement', programme?.event, false]
    ].map(([label, value, vertical]) => ({
      label,
      values: valueLines(value, vertical),
      vertical
    })).filter((field) => field.values.length);
  }

  function rowsForPayload(kind, payload, featureKey = '') {
    if (!payload) return [];
    if (kind === 'matrix') {
      const results = Array.isArray(payload.results) ? payload.results : [];
      return results
        .map((row) => ({
          label: matrixHistoryLabel(row),
          fields: matrixHistoryFields(row, payload)
        }))
        .filter((row) => row.fields.length);
    }
    if (kind === 'rejected') {
      // Same reading order and labels as the daily Boules rejetées view.
      const programmes = Array.isArray(payload.programmes)
        ? payload.programmes.filter((programme) => (
          programme && Array.isArray(programme.groups) && programme.groups.length
        ))
        : [];
      if (programmes.length) {
        return programmes.map((programme) => ({
          label: [
            programme.country || 'Pays',
            Number.isFinite(Number(programme.hour))
              ? `${String(programme.hour).padStart(2, '0')}h`
              : '',
            programme.name || ''
          ].filter(Boolean).join(' · '),
          balls: programme.groups.map((value) => String(value).padStart(2, '0'))
        }));
      }
      const groups = payload.groups || {};
      const names = {
        ghana: 'Ghana',
        coteDIvoire: "Côte d'Ivoire",
        benin: 'Bénin',
        niger: 'Niger',
        senegal: 'Sénégal',
        togo: 'Togo'
      };
      const ordered = [
        ...Object.keys(names).filter((name) => name in groups),
        ...Object.keys(groups).filter((name) => !(name in names))
      ];
      return ordered
        .map((name) => [name, groups[name]])
        .filter(([, values]) => Array.isArray(values) && values.length)
        .map(([name, values]) => ({
          label: names[name] || name,
          balls: values.map((value) => String(value).padStart(2, '0'))
        }));
    }
    const plan = resolveTableauPlan(payload, featureKey) || payload;
    return [
      ['Clé', plan?.key],
      ['Ordre', plan?.order],
      ['Code', plan?.code],
      ['Croix', plan?.cross],
      ['NAP', plan?.nap]
    ].map(([label, value]) => ({
      label,
      value: normalizeValues(value)
    })).filter((row) => row.value);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  /*
   * Tableaux owns a large, already-approved bridge stylesheet. Anticipé
   * scopes that same stylesheet to its cloned portfolio; history does the
   * identical thing here instead of maintaining a third visual copy.
   */
  function ensureHistoryTableauxBridge() {
    // The scoped bridge is part of the application stylesheet.
    return Promise.resolve(null);
  }

  const TABLEAU_PORTFOLIO_CLASS = Object.freeze(Object.fromEntries(
    TABLEAU_DEFINITIONS.map(({ featureKey, portfolioClass }) => (
      [featureKey, portfolioClass]
    ))
  ));

  /*
   * History deliberately mounts a clone of the official portfolio. The
   * clone keeps the same DOM, classes and loaded styles as the live Tableaux
   * view; only its date-specific values are hydrated below.
   */
  function tableauVisualMarkup(featureKey) {
    return `
      <div class="cid-publication-history__tableau-mount"
           data-history-tableau-mount="${escapeAttribute(featureKey)}">
        <span>Chargement du tableau…</span>
      </div>`;
  }

  function tableauSource(featureKey) {
    const normalizedFeatureKey = normalizeTableauFeatureKey(featureKey);
    if (normalizedFeatureKey === 'tableaux-created') {
      return document.querySelector(
        '#tableauxViewContainer #createdProgramPortfolios'
      );
    }
    const selector = TABLEAU_PORTFOLIO_CLASS[normalizedFeatureKey];
    if (!selector) return null;
    /*
     * Only the hidden/live Tableaux shell is a source of truth. A previous
     * archive card is also a portfolio clone, so a document-wide fallback
     * could accidentally clone a clone and compound its markup.
     */
    return document.querySelector(`#tableauxViewContainer .${selector}`);
  }

  function textValue(value, fallback = HISTORY_VALUE_ZERO) {
    if (Array.isArray(value)) {
      const values = value
        .map((entry) => typeof entry === 'object' ? entry?.value : entry)
        .filter((entry) => entry !== undefined && entry !== null && String(entry).trim());
      return values.length ? values.join(' ') : fallback;
    }
    if (value && typeof value === 'object') {
      const values = Object.values(value)
        .filter((entry) => entry !== undefined && entry !== null && String(entry).trim());
      return values.length ? values.join(' · ') : fallback;
    }
    return value !== undefined && value !== null && String(value).trim()
      ? String(value)
      : fallback;
  }

  function setText(root, selector, value, fallback = HISTORY_VALUE_ZERO) {
    root.querySelectorAll(selector).forEach((element) => {
      element.textContent = textValue(value, fallback);
    });
  }

  function formatCombination(combination) {
    if (!Array.isArray(combination) || !combination.length) return '00 + 00';
    const operator = combination.operator || '+';
    return combination.map((part, index) => (
      `${index ? ` ${operator} ` : ''}${String(textValue(
        typeof part === 'object' ? part?.value : part,
        HISTORY_VALUE_ZERO
      )).padStart(2, '0')}`
    )).join('');
  }

  function paintHistoricalTable(table, plan) {
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const footerIndex = rows.findIndex((row, index) => (
      index >= 2 && row.querySelector('th[colspan]')
    ));
    const rowTemplate = rows[2]?.cloneNode(true) || (() => {
      const row = document.createElement('tr');
      row.innerHTML = '<td></td><td></td><td></td>';
      return row;
    })();
    rows.slice(2, footerIndex === -1 ? rows.length : footerIndex)
      .forEach((row) => row.remove());
    const satellites = Array.isArray(plan?.satellites) ? plan.satellites : [];
    const body = table.tBodies[0];
    const footerRow = Array.from(table.querySelectorAll('tr'))
      .find((row, index) => index >= 2 && row.querySelector('th[colspan]'));
    const rowsToPaint = satellites.length ? satellites : [null];
    rowsToPaint.forEach((satellite) => {
      const row = rowTemplate.cloneNode(true);
      row.classList.toggle('cid-history-placeholder-row', !satellite);
      const cells = row.children;
      if (cells[0]) cells[0].textContent = String(
        textValue(satellite?.value, HISTORY_VALUE_ZERO)
      ).padStart(2, '0');
      if (cells[1]) cells[1].textContent = formatCombination(satellite?.combinations?.[0]);
      if (cells[2]) cells[2].textContent = formatCombination(satellite?.combinations?.[1]);
      body?.insertBefore(row, footerRow || null);
    });
    const nap = plan?.nap || {};
    /*
     * Keep the three cells positional: NAP1, NAP1, NAP2. Concatenating the
     * arrays first shifts a one-number NAP2 into the second NAP1 cell and
     * leaves the real NAP2 cell at 00.
     */
    const napValues = [
      Array.isArray(nap.nap1) ? nap.nap1[0] : null,
      Array.isArray(nap.nap1) ? nap.nap1[1] : null,
      Array.isArray(nap.nap2)
        ? nap.nap2.filter((entry) => (
          entry !== undefined && entry !== null && String(entry).trim()
        )).join(' ')
        : null
    ];
    table.querySelectorAll('.nap-value').forEach((element, index) => {
      element.textContent = textValue(napValues[index]);
    });
  }

  function paintHistoricalStandby(root, payload, date) {
    const table = root.querySelector('.standby-week-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const template = tbody.querySelector('tr')?.cloneNode(true);
    tbody.replaceChildren();
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!template) return;
    const rowsToPaint = rows.length ? rows : [null];
    rowsToPaint.forEach((item) => {
      const row = template.cloneNode(true);
      row.classList.toggle('cid-history-placeholder-row', !item);
      const cells = row.children;
      cells[0].textContent = item?.countryDisplay || item?.country || '0';
      cells[1].textContent = textValue(item?.nap2, HISTORY_VALUE_ZERO);
      cells[2].textContent = textValue(item?.permutation, HISTORY_VALUE_ZERO);
      tbody.appendChild(row);
    });
    root.querySelectorAll('.table-date').forEach((element) => {
      element.textContent = dateLabel(date);
    });
  }

  function planForPayload(payload, featureKey) {
    return resolveTableauPlan(payload, featureKey);
  }

  /*
   * The live Tableaux shell is also the visual source for an archive card.
   * Its nodes can contain the current day's values, or a locked preview, at
   * the moment the clone is made. Clear every result-bearing node first so a
   * historical card never leaks today's values while its own payload is
   * loading. A missing historical value is deliberately shown as 0.
   */
  function resetHistoricalValues(root) {
    if (!root) return;
    root.querySelectorAll([
      '.key-container .numbers',
      '.order-container .numbers',
      '.key-info strong',
      '.cross-number',
      '.satellite-number',
      '.nap-value',
      '.created-program-key',
      '.created-program-order',
      '.created-program-cross b',
      '.standby-week-table tbody td:not(.standby-country-cell)'
    ].join(', ')).forEach((element) => {
      if (element.matches('.key-container .numbers, .order-container .numbers')) {
        element.textContent = HISTORY_KEY_ZERO;
      } else if (element.matches('.cross-number')) {
        element.textContent = HISTORY_CROSS_ZERO;
      } else {
        element.textContent = HISTORY_VALUE_ZERO;
      }
      element.classList.remove('cid-tableaux-masked-value');
      element.removeAttribute('data-number');
    });
    root.querySelectorAll('.cross-base-numbers, .cross-base-number')
      .forEach((element) => element.remove());
  }

  function keepHistoryKeyReadable(root) {
    if (!root) return;
    root.querySelectorAll('.key-info').forEach((info) => {
      info.style.setProperty('max-width', '100%', 'important');
      info.style.setProperty('overflow', 'visible', 'important');
      info.style.setProperty('white-space', 'normal', 'important');
      info.style.setProperty('overflow-wrap', 'anywhere', 'important');
      info.style.setProperty('line-height', '1.25', 'important');
      const paragraph = info.querySelector('p');
      paragraph?.style.setProperty('max-width', '100%', 'important');
      paragraph?.style.setProperty('overflow', 'visible', 'important');
      paragraph?.style.setProperty('white-space', 'normal', 'important');
      info.querySelectorAll('strong').forEach((value) => {
        value.style.setProperty('display', 'inline-block', 'important');
        value.style.setProperty('max-width', '100%', 'important');
        value.style.setProperty('overflow', 'visible', 'important');
        value.style.setProperty('white-space', 'normal', 'important');
        value.style.setProperty('overflow-wrap', 'anywhere', 'important');
      });
    });
    root.querySelectorAll(
      ':scope > .container:nth-child(-n + 2), ' +
      '.created-program-template > .container:nth-child(-n + 2)'
    ).forEach((container) => {
      container.style.setProperty('overflow', 'visible', 'important');
    });
  }

  function valueOrZero(value, fallback = HISTORY_VALUE_ZERO) {
    return value === undefined || value === null || String(value).trim() === ''
      ? fallback
      : String(value);
  }

  function paintHistoricalCreatedProgram(card, program, date) {
    if (!card) return;
    const plan = program || {};
    card.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = dateLabel(date);
    });
    const title = String(
      plan.displayName || plan.name || plan.id || ''
    ).trim();
    const label = title
      .replace(/^satellites?\s+croix\s+/i, '')
      .replace(/^croix\s+/i, '')
      .replace(/^clé\s+/i, '')
      .trim()
      .toLocaleUpperCase(window.cidTranslation?.current?.() || 'fr') || 'PROGRAMME';
    const tableauTitle = `CLÉ ${label}`;
    card.querySelectorAll('.title-text').forEach((element, index) => {
      element.textContent = index === 1
        ? `CROIX ${tableauTitle.replace(/^CLÉ /, '')}`
        : tableauTitle;
    });
    const isStandby = Boolean(card.querySelector('.standby-week-table'));
    card.querySelectorAll('th[colspan]').forEach((header, index) => {
      const dateElement = header.querySelector('.table-date');
      header.replaceChildren(
        ...(dateElement ? [dateElement] : []),
        document.createTextNode(
          isStandby
            ? `STAND-BY ${label}`
            : index === 0 ? `SATELLITES CROIX ${label}` : tableauTitle
        )
      );
    });
    const key = card.querySelector('.key-container .numbers');
    const order = card.querySelector('.order-container .numbers');
    if (key) key.textContent = valueOrZero(plan.key, HISTORY_KEY_ZERO);
    if (order) order.textContent = valueOrZero(plan.order, HISTORY_KEY_ZERO);
    card.querySelectorAll('.key-info strong').forEach((element, index) => {
      element.textContent = valueOrZero([
        plan.code,
        plan.filter,
        plan.addition
      ][index]);
    });
    const cross = plan.cross || {};
    [
      ['.cross-number-1', cross.top],
      ['.cross-number-2', cross.bottom],
      ['.cross-number-3', cross.right],
      ['.cross-number-6', cross.left]
    ].forEach(([selector, value]) => {
      const element = card.querySelector(selector);
      if (element) element.textContent = valueOrZero(value, HISTORY_CROSS_ZERO);
    });
    if (isStandby) {
      paintHistoricalStandby(card, plan, date);
    } else {
      paintHistoricalTable(card.querySelector(
        '.universal-satellites, .intuition-cross-satellites, ' +
        '.oracle-satellites, .manual-satellites, .lnb-satellites'
      ), plan);
    }
  }

  function hydrateHistoricalCreatedPrograms(clone, payload, date) {
    if (!clone) return;
    const programs = Array.isArray(payload?.createdPrograms)
      ? payload.createdPrograms
      : [];
    const byId = new Map(programs.map((program) => [
      String(program?.id || '').toLowerCase(),
      program
    ]));
    clone.querySelectorAll('.created-program-card').forEach((card) => {
      const id = String(card.id || '')
        .replace(/^created-program-/, '')
        .toLowerCase();
      paintHistoricalCreatedProgram(card, byId.get(id), date);
    });
  }

  function hydrateHistoricalTableau(card, payload, featureKey, date) {
    const mount = card?.querySelector('[data-history-tableau-mount]');
    if (!mount) return;
    const normalizedFeatureKey = normalizeTableauFeatureKey(featureKey);
    const source = tableauSource(normalizedFeatureKey);
    if (!source) {
      mount.innerHTML = '<span>Aucun tableau disponible.</span>';
      return;
    }
    const clone = source.cloneNode(true);
    const isCreated = normalizedFeatureKey === 'tableaux-created';
    const renderRoot = isCreated
      ? document.createElement('div')
      : clone;
    if (isCreated) {
      renderRoot.className = 'cid-publication-history__tableau-clone cid-tableaux-scope';
      renderRoot.appendChild(clone);
      clone.classList.add('cid-publication-history__created-source');
    }
    if (!isCreated) clone.removeAttribute('id');
    clone.hidden = false;
    clone.removeAttribute('hidden');
    clone.classList.add('cid-publication-history__tableau-clone', 'cid-tableaux-scope');
    clone.style.setProperty('background', 'transparent', 'important');
    clone.style.setProperty('border', '0', 'important');
    clone.style.setProperty('box-shadow', 'none', 'important');
    clone.style.setProperty('display', 'grid', 'important');
    clone.style.setProperty(
      'grid-template-columns',
      'repeat(2, minmax(0, 1fr))',
      'important'
    );
    clone.style.setProperty('gap', '12px', 'important');
    clone.style.setProperty('width', '100%', 'important');
    clone.style.setProperty('min-width', '0', 'important');
    clone.style.setProperty('padding', isCreated ? '16px 10px' : '0 12px', 'important');
    if (!isCreated) {
      clone.querySelectorAll('[id]').forEach((element) => {
        element.removeAttribute('id');
      });
    }
    clone.querySelectorAll(
      '.tableaux-access-badge, .tableaux-history-button, [data-tableaux-access]'
    ).forEach((element) => element.remove());
    resetHistoricalValues(clone);
    keepHistoryKeyReadable(clone);
    clone.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = dateLabel(date);
    });
    if (isCreated) {
      clone.style.setProperty('display', 'block', 'important');
      clone.style.setProperty('grid-template-columns', 'none', 'important');
      clone.style.setProperty('gap', '0', 'important');
      renderRoot.style.setProperty('display', 'block', 'important');
      renderRoot.style.setProperty('padding', '0', 'important');
      renderRoot.style.setProperty('background', '#fff', 'important');
      hydrateHistoricalCreatedPrograms(clone, payload, date);
      mount.replaceChildren(renderRoot);
      return;
    }
    let cardCount = 0;
    Array.from(clone.children).forEach((child) => {
      if (child.classList?.contains('container') && cardCount < 2) {
        child.style.setProperty('grid-column', String(cardCount + 1), 'important');
        child.style.setProperty('width', '100%', 'important');
        child.style.setProperty('min-width', '0', 'important');
        cardCount += 1;
      } else if (child.classList?.contains('table-container')) {
        child.style.setProperty('grid-column', '1 / -1', 'important');
        child.style.setProperty('width', '100%', 'important');
        child.style.setProperty('min-width', '0', 'important');
      }
    });

    if (normalizedFeatureKey === 'tableaux-standby') {
      paintHistoricalStandby(clone, payload?.standby || payload, date);
    } else {
      const plan = planForPayload(payload, normalizedFeatureKey) || {};
      setText(clone, '.key-container .numbers', plan.key, HISTORY_KEY_ZERO);
      setText(clone, '.order-container .numbers', plan.order, HISTORY_KEY_ZERO);
      const info = clone.querySelectorAll('.key-info strong');
      [plan.code, plan.filter, plan.addition].forEach((value, index) => {
        if (info[index]) info[index].textContent = textValue(value);
      });
      const cross = plan.cross || {};
      [
        ['.cross-number-1', cross.top],
        ['.cross-number-2', cross.bottom],
        ['.cross-number-3', cross.right],
        ['.cross-number-6', cross.left]
      ].forEach(([selector, value]) => (
        setText(clone, selector, value, HISTORY_CROSS_ZERO)
      ));
      const table = clone.querySelector('.table-container table');
      paintHistoricalTable(table, plan);
    }
    mount.replaceChildren(clone);
  }

  function socialPostId(kind, date, featureKey = '') {
    if (kind === 'tableaux') return `${featureKey}:${isoDate(date)}`;
    return `${kind}:${isoDate(date)}`;
  }

  function socialMarkup(kind, date, featureKey = '') {
    const id = socialPostId(kind, date, featureKey);
    return `
      <div class="cid-publication-history__social" data-history-social data-post-id="${escapeAttribute(id)}">
        <button type="button" data-history-like aria-pressed="false">
          <span aria-hidden="true">👍</span> J’aime <b data-history-like-count>0</b>
        </button>
        <button type="button" data-history-share>
          <span aria-hidden="true">↗</span> Partager <b data-history-share-count>0</b>
        </button>
        <span class="cid-publication-history__social-status" role="status" aria-live="polite"></span>
      </div>`;
  }

  function historyRequestKey(kind, date, featureKey = '') {
    return historyCacheKey({
      kind,
      date: isoDate(date),
      featureKey: kind === 'tableaux' ? featureKey : ''
    });
  }

  function cachedPayload(kind, date, featureKey = '') {
    return readHistoryPayload(historyRequestKey(kind, date, featureKey));
  }

  function payloadHasErrors(payload) {
    if (!payload || typeof payload !== 'object') return true;
    if (Array.isArray(payload.errors) && payload.errors.length) return true;
    // An empty answer usually means the date was not published yet when it
    // was read; it must be retried instead of being frozen on the device.
    if (Array.isArray(payload.results) && !payload.results.length) return true;
    if (payload.groups && typeof payload.groups === 'object'
      && !Object.keys(payload.groups).length) return true;
    return false;
  }

  function isFinalCachedEntry(entry) {
    return Boolean(entry?.value) && !payloadHasErrors(entry.value);
  }

  function requestHistoryPayload(kind, date, featureKey = '') {
    const key = historyRequestKey(kind, date, featureKey);
    const existing = historyInFlight.get(key);
    if (existing) return existing;
    const request = fetchHistoryPayload({
      kind,
      date,
      featureKey
    }).finally(() => {
      if (historyInFlight.get(key) === request) historyInFlight.delete(key);
    });
    historyInFlight.set(key, request);
    return request;
  }

  function cardMarkup(kind, date, payload, featureKey = '') {
    const rows = rowsForPayload(kind, payload, featureKey);
    const label = kind === 'tableaux'
      ? labelForTableau(featureKey)
      : LABELS[kind];
    const dateValue = isoDate(date);
    const matrixBody = rows.map((row) => `
      <section class="cid-publication-history__matrix-program">
        <h3>${escapeHtml(row.label)}</h3>
        <div class="cid-publication-history__matrix-fields">
          ${(row.fields || []).map((field) => `
            <div class="cid-publication-history__matrix-field">
              <strong>${escapeHtml(field.label)}</strong>
              ${field.vertical
                ? `<span class="cid-publication-history__matrix-values">${field.values.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</span>`
                : `<span>${escapeHtml(field.values.join(' · '))}</span>`}
            </div>`).join('')}
        </div>
      </section>`).join('');
    const body = !payload
      ? `<p class="cid-publication-history__placeholder" data-history-placeholder>
          <span aria-hidden="true">Synchronisation de cette date…</span>
        </p>`
      : kind === 'tableaux'
      ? tableauVisualMarkup(featureKey)
      : kind === 'matrix'
        ? matrixBody || '<p>Aucun résultat publié pour cette date.</p>'
        : rows.length
          ? rows.map((row) => `
            <div class="cid-publication-history__row">
              <strong>${escapeHtml(row.label)}</strong>
              ${Array.isArray(row.balls)
                ? `<span class="cid-publication-history__balls">${row.balls.map((ball) => `<b>${escapeHtml(ball)}</b>`).join('')}</span>`
                : `<span>${escapeHtml(row.value || '—')}</span>`}
            </div>`).join('')
          : '<p>Aucun résultat publié pour cette date.</p>';
    const archiveMeta = kind === 'tableaux'
      ? ''
      : `<div class="cid-publication-history__date">
          <strong>${escapeHtml(dateLabel(date))}</strong>
          <span>${escapeHtml(label)} · archive publiée</span>
        </div>`;
    const actions = kind === 'tableaux'
      ? ''
      : socialMarkup(kind, date, featureKey);
    const stableKey = `${kind}:${dateValue}:${featureKey || 'default'}`;
    return `
      <article
        class="cid-publication-history__card${kind === 'tableaux' ? ' is-tableau' : ''}"
        data-history-key="${escapeAttribute(stableKey)}"
        data-history-kind="${escapeAttribute(kind)}"
        data-history-date="${escapeAttribute(dateValue)}"
        data-history-state="${payload ? 'cached' : 'loading'}">
        ${archiveMeta}
        <div class="cid-publication-history__body">
          ${kind === 'tableaux' ? '' : `<h2>${escapeHtml(label)}</h2>`}
          ${body}
        </div>
        ${actions}
      </article>`;
  }

  function setHistorySyncStatus(root, message, state = '') {
    const status = root?.querySelector('[data-history-sync-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function setCardSyncState(card, state, message = '') {
    if (!card) return;
    card.dataset.historyState = state;
    if (message) card.setAttribute('data-history-message', message);
    else card.removeAttribute('data-history-message');
  }

  function updateNonTableauCard(card, kind, date, payload, featureKey = '') {
    if (!card || kind === 'tableaux') return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardMarkup(kind, date, payload, featureKey);
    const nextCard = wrapper.firstElementChild;
    const currentBody = card.querySelector('.cid-publication-history__body');
    const nextBody = nextCard?.querySelector('.cid-publication-history__body');
    if (currentBody && nextBody) currentBody.replaceChildren(...nextBody.childNodes);
    const currentMeta = card.querySelector('.cid-publication-history__date');
    const nextMeta = nextCard?.querySelector('.cid-publication-history__date');
    if (currentMeta && nextMeta) currentMeta.replaceChildren(...nextMeta.childNodes);
    card.removeAttribute('data-history-message');
  }

  function lockedMarkup(kind) {
    return `
      <section class="cid-publication-history__locked">
        <strong>Historique verrouillé</strong>
        <span>Votre accès à ${escapeHtml(LABELS[kind] || 'ce programme')} est nécessaire pour afficher les neuf dernières publications.</span>
        <br>
        <button type="button" class="cid-publication-history__unlock">Voir les accès</button>
      </section>`;
  }

  async function show({ kind, featureKey = '', returnTo = null } = {}) {
    if (!['matrix', 'rejected', 'tableaux'].includes(kind)) return false;
    const requestToken = ++historyRequestToken;
    const host = get(HOST_ID);
    const mount = get(MOUNT_ID);
    if (!host || !mount) return false;

    const canonicalFeatureKey = kind === 'tableaux'
      ? normalizeTableauFeatureKey(featureKey)
      : '';
    const historyTitle = `Historique · ${
      kind === 'tableaux' ? labelForTableau(canonicalFeatureKey) : LABELS[kind]
    }`;
    const leaveHistory = () => {
      // Cancel any access/tableau hydration that is still in flight when the
      // user taps Back before the route has finished loading.
      historyRequestToken += 1;
      if (typeof returnTo === 'function') returnTo();
      else window.showHomeView?.();
    };
    window.cidShowDedicatedView?.({
      id: 'history',
      title: historyTitle,
      onBack: leaveHistory
    });
    ['results', 'categoriesView', 'croixViewContainer', 'tableauxViewContainer',
      'matrixCalculatorPanel', 'anticipationViewContainer', 'topBanner',
      'redCross', 'redCrossClone', 'countryButtons', 'site-plant',
      'notificationCenter'].forEach((id) => {
      const element = get(id);
      if (!element) return;
      element.hidden = true;
      element.style.display = 'none';
      element.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove(
      'accueil-active', 'categories-active', 'croix-active',
      'matrice-active', 'rejected-active', 'tableaux-active',
      'anticipation-active'
    );
    document.body.classList.add('archive-active');
    host.hidden = false;
    host.style.display = 'block';
    host.setAttribute('aria-hidden', 'false');
    // Paint the route shell before checking entitlements. The access request
    // may involve Supabase and must never make the back affordance appear
    // unresponsive on a touch device.
    /*
     * Mount the complete archive rail before the access check. The access
     * request is allowed to change only this route's local state; it can
     * never expose a blank host or move the persistent shell.
     */
    const archiveDates = dates();
    mount.innerHTML = `
      <div class="cid-publication-history" aria-busy="true">
        <header class="cid-publication-history__header">
          <span class="cid-publication-history__eyebrow">Archives récentes</span>
          <h1>${escapeHtml(kind === 'tableaux' ? labelForTableau(canonicalFeatureKey) : LABELS[kind])}</h1>
          <p>Les neuf dernières publications défilent horizontalement.</p>
          <span class="cid-publication-history__sync" data-history-sync-status role="status" aria-live="polite">Préparation…</span>
        </header>
        <div class="cid-publication-history__track" data-publication-history-track>
          ${archiveDates.map((date) => cardMarkup(
            kind,
            date,
            null,
            canonicalFeatureKey
          )).join('')}
        </div>
      </div>`;

    const allowed = await hasAccess(kind, canonicalFeatureKey);
    if (requestToken !== historyRequestToken) return false;

    if (kind === 'tableaux') {
      const sourceSelector = TABLEAU_PORTFOLIO_CLASS[canonicalFeatureKey];
      if (!(sourceSelector
        ? document.querySelector(`#tableauxViewContainer ${sourceSelector}`)
        : tableauSource(canonicalFeatureKey))) {
        await window.cidEnsureTableauxMounted?.();
      }
      // A prior Tableaux visit may have removed its route-scoped styles while
      // leaving the shell in the DOM. Reattach them before cloning so history
      // stays pixel-identical after every navigation path.
      await window.cidEnsureTableauxStyles?.();
      await ensureHistoryTableauxBridge();
      if (requestToken !== historyRequestToken) return false;
    }

    if (!allowed) {
      mount.innerHTML = `<div class="cid-publication-history">${lockedMarkup(kind)}</div>`;
      mount.querySelector('.cid-publication-history__unlock')?.addEventListener(
        'click',
        () => window.showProfileView?.({ updateHistory: true })
      );
      return true;
    }

    const track = mount.querySelector('[data-publication-history-track]');
    const cachedEntries = archiveDates.map((date) => (
      cachedPayload(kind, date, canonicalFeatureKey)
    ));
    const cards = archiveDates.map((date, index) => {
      const stableKey = `${kind}:${isoDate(date)}:${canonicalFeatureKey || 'default'}`;
      const existing = Array.from(track?.children || []).find((card) => (
        card.dataset.historyKey === stableKey
      ));
      if (existing) return existing;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = cardMarkup(
        kind,
        date,
        null,
        canonicalFeatureKey
      );
      const card = wrapper.firstElementChild;
      track?.appendChild(card);
      return card;
    });
    if (kind === 'tableaux') {
      /*
       * Paint every official portfolio clone immediately. This is the stable
       * white card/mould seen before the network responds; the fetch below
       * only hydrates its values and never decides whether the table exists.
      */
      cards.forEach((card, index) => {
        hydrateHistoricalTableau(
          card,
          cachedEntries[index]?.value || null,
          canonicalFeatureKey,
          archiveDates[index]
        );
      });
    } else {
      cards.forEach((card, index) => {
        const payload = cachedEntries[index]?.value || null;
        if (payload) updateNonTableauCard(
          card,
          kind,
          archiveDates[index],
          payload,
          canonicalFeatureKey
        );
        wireHistorySocial(card);
      });
    }

    const cachedCount = cachedEntries.filter(Boolean).length;
    setHistorySyncStatus(
      mount,
      cachedCount ? 'Synchronisation en arrière-plan…' : 'Chargement des archives…',
      'syncing'
    );
    /*
     * localStorage first: a cached publication is final for its date (a new
     * publication always arrives under a new date), so only dates missing
     * from the device — or cached with a partial/errored payload — are
     * requested. Revisits and offline visits therefore make no database call.
     */
    const pendingIndexes = archiveDates
      .map((_, index) => index)
      .filter((index) => !isFinalCachedEntry(cachedEntries[index]));
    cards.forEach((card, index) => {
      if (!pendingIndexes.includes(index)) setCardSyncState(card, 'fresh');
    });
    if (!pendingIndexes.length) {
      setHistorySyncStatus(mount, 'Historique synchronisé', 'ready');
      void Promise.all(cards.map((card) => hydrateHistorySocial(card)));
      return true;
    }
    let pendingCount = pendingIndexes.length;
    let failedCount = 0;
    const settleSyncStatus = () => {
      pendingCount -= 1;
      if (pendingCount > 0 || requestToken !== historyRequestToken) return;
      setHistorySyncStatus(
        mount,
        failedCount
          ? `${failedCount} date${failedCount > 1 ? 's' : ''} conservée${failedCount > 1 ? 's' : ''} depuis le cache`
          : 'Historique synchronisé',
        failedCount ? 'error' : 'ready'
      );
    };
    pendingIndexes.forEach((index) => {
      const date = archiveDates[index];
      requestHistoryPayload(kind, date, canonicalFeatureKey)
        .then((payload) => {
          if (!payloadHasErrors(payload)) {
            writeHistoryPayload(
              historyRequestKey(kind, date, canonicalFeatureKey),
              payload
            );
          }
          if (requestToken !== historyRequestToken) return;
          if (kind === 'tableaux') {
            hydrateHistoricalTableau(
              cards[index],
              payload,
              canonicalFeatureKey,
              date
            );
          } else {
            updateNonTableauCard(
              cards[index],
              kind,
              date,
              payload,
              canonicalFeatureKey
            );
          }
          setCardSyncState(cards[index], 'fresh');
          settleSyncStatus();
        })
        .catch((error) => {
          if (requestToken !== historyRequestToken) return;
          failedCount += 1;
          // Preserve the cached/placeholder card. A failed refresh must never
          // destroy the last valid publication already visible to the user.
          const hasCachedValue = Boolean(cachedEntries[index]?.value);
          setCardSyncState(
            cards[index],
            hasCachedValue ? 'stale' : 'unavailable',
            error?.message || 'Synchronisation indisponible.'
          );
          setHistorySyncStatus(
            mount,
            hasCachedValue
              ? 'Hors ligne · dernières données locales conservées'
              : 'Synchronisation indisponible · nouvel essai automatique',
            'error'
          );
          settleSyncStatus();
        });
    });
    void Promise.all(cards.map((card) => hydrateHistorySocial(card)));
    return true;
  }

  function setHistorySocialStatus(card, message = '') {
    const status = card?.querySelector('.cid-publication-history__social-status');
    if (status) status.textContent = message;
  }

  function paintHistoryMetrics(card, metrics) {
    if (!card || !metrics) return;
    const likes = Math.max(0, Number(metrics.likes) || 0);
    const shares = Math.max(0, Number(metrics.shares) || 0);
    const likeButton = card.querySelector('[data-history-like]');
    const likeCount = card.querySelector('[data-history-like-count]');
    const shareCount = card.querySelector('[data-history-share-count]');
    if (likeCount) likeCount.textContent = String(likes);
    if (shareCount) shareCount.textContent = String(shares);
    likeButton?.setAttribute('aria-pressed', String(Boolean(metrics.liked)));
    likeButton?.classList.toggle('is-liked', Boolean(metrics.liked));
  }

  async function hydrateHistorySocial(card) {
    const postId = card?.dataset?.postId
      || card?.querySelector('[data-post-id]')?.dataset?.postId;
    if (!card || !postId) return;
    try {
      paintHistoryMetrics(card, await getPostMetrics(postId));
    } catch (_) {
      // A missing social table must not prevent the archived publication from
      // rendering. The buttons remain available for a later retry.
    }
  }

  function wireHistorySocial(card) {
    if (!card || card.dataset.historySocialWired === 'true') return;
    card.dataset.historySocialWired = 'true';
    const social = card.querySelector('[data-history-social]');
    const postId = social?.dataset.postId || '';
    const requireAccount = (action) => (
      window.cidSocialAuthGate?.requireAccount?.(action)
      || Promise.resolve(null)
    );

    card.querySelector('[data-history-like]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const user = await requireAccount('aimer cette publication');
      if (!user) return;
      button.disabled = true;
      try {
        const liked = await togglePostLike(postId);
        paintHistoryMetrics(card, await getPostMetrics(postId));
        if (liked) window.cidPlayLikeSound?.();
      } catch (error) {
        setHistorySocialStatus(card, error?.message || 'Like indisponible.');
      } finally {
        button.disabled = false;
      }
    });

    card.querySelector('[data-history-share]')?.addEventListener('click', async () => {
      const title = card.querySelector('.cid-publication-history__body h2')?.textContent
        || 'Publication Cidmap';
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'history');
      url.searchParams.set('publication', postId);
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title, text: title, url: url.toString() });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(`${title}\n${url.toString()}`);
        } else {
          throw new Error('Partage indisponible sur cet appareil.');
        }
        await recordPostShare(postId, 'archive');
        paintHistoryMetrics(card, await getPostMetrics(postId));
        setHistorySocialStatus(card, 'Publication partagée.');
      } catch (error) {
        // Closing the native share sheet is not an error worth surfacing.
        if (error?.name !== 'AbortError') {
          setHistorySocialStatus(card, error?.message || 'Partage indisponible.');
        }
      }
    });
  }

  function mountTableauHistoryButtons() {
    document.querySelectorAll(TABLEAU_SELECTORS).forEach((portfolio) => {
      /*
       * Archive cards are official DOM clones, not live Tableau sections.
       * Keep the observer from appending a second "Voir plus" control (or
       * otherwise mutating a hydrated clone) every time one is mounted.
       */
      if (!portfolio.closest('#tableauxViewContainer')) return;
      if (portfolio.closest('[data-created-portfolio-clone="true"]')) return;
      if (portfolio.querySelector(':scope > .tableaux-history-button')) return;
      const rawFeatureKey = portfolio.dataset.tableauxAccess
        || portfolio.dataset.tableauxFeature
        || (portfolio.dataset.tableauxProgram
          ? `tableaux-${portfolio.dataset.tableauxProgram}`
          : '')
        || keyForTableau(portfolio);
      const featureKey = normalizeTableauFeatureKey(rawFeatureKey);
      if (!featureKey || featureKey === 'tableaux-') return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tableaux-history-button';
      button.textContent = 'Voir plus';
      button.setAttribute('aria-label', `Voir l’historique ${labelForTableau(featureKey)}`);
      button.addEventListener('click', () => {
        const componentId = ({
          'tableaux-universelle': 'universal',
          'tableaux-intuition': 'intuition',
          'tableaux-oracle': 'oracle',
          'tableaux-lnb': 'lnb',
          'tableaux-balsa': 'balsa',
          'tableaux-standby': 'standby'
        })[featureKey] || featureKey.replace(/^tableaux-/, '');
        const component = window.cidTableauComponents?.get?.(componentId);
        if (component?.openHistory?.()) return;
        show({
          kind: 'tableaux',
          featureKey,
          returnTo: () => window.showTableauxView?.({ updateHistory: false })
        });
      });
      portfolio.appendChild(button);
    });
  }

  // Coalesced: one scan per frame instead of one per mutation batch.
  let historyButtonsFrame = 0;
  const observer = new MutationObserver(() => {
    if (historyButtonsFrame) return;
    historyButtonsFrame = window.requestAnimationFrame(() => {
      historyButtonsFrame = 0;
      mountTableauHistoryButtons();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(mountTableauHistoryButtons, 0);

  /*
   * Subscription prefetch.
   *
   * From the first day of a subscription or unlock, the nine archive dates of
   * every programme covered by the account are downloaded once in the
   * background and stored in localStorage (the same entries the archive view
   * paints first). Values come unchanged from the server loaders; a programme
   * that is not covered is never requested and keeps its 00 / 000000 / 0
   * placeholders.
   */
  const PREFETCH_DELAY_MS = 2500;
  const PREFETCH_CONCURRENCY = 2;
  const prefetchDone = new Set();
  let prefetchTimer = 0;
  let prefetchRunning = false;

  function hasPaidEntitlement(access) {
    if (!access) return false;
    const subscription = access.subscription;
    const subscribed = subscription?.status === 'active'
      && (!subscription.expires_at || Date.parse(subscription.expires_at) > Date.now());
    const unlocked = (access.featureUnlocks || []).some((unlock) => (
      !unlock?.expires_at || Date.parse(unlock.expires_at) > Date.now()
    ));
    return subscribed || unlocked;
  }

  function prefetchTargets() {
    const featureAccess = window.cidFeatureAccess;
    const access = featureAccess?.state?.();
    if (!access || access.__offline) return null;
    const allowed = (key) => featureAccess.has?.(key) === true;
    const paid = hasPaidEntitlement(access);
    /*
     * Matrice and Boules rejetées are pre-recorded whenever the account can
     * read them, including while the main administrator keeps them free.
     * Tableaux keep the subscription-only prefetch.
     */
    const matrix = allowed('matrice');
    const rejected = allowed('boules-rejetees');
    if (!paid && !matrix && !rejected) return null;
    return {
      matrix,
      rejected,
      tableaux: !paid ? [] : [
        ...TABLEAU_DEFINITIONS.map(({ featureKey }) => normalizeTableauFeatureKey(featureKey)),
        'tableaux-created'
      ].filter((key, index, keys) => key && keys.indexOf(key) === index && allowed(key))
    };
  }

  function needsPrefetch(kind, date, featureKey, today) {
    void today;
    // A cached publication is final for its date; only missing or partial
    // entries are requested so revisits never saturate the database.
    return !isFinalCachedEntry(cachedPayload(kind, date, featureKey));
  }

  async function runPrefetchTask({ kind, date, featureKeys }) {
    const payload = await requestHistoryPayload(kind, date, featureKeys[0] || '');
    if (!payload || (Array.isArray(payload.errors) && payload.errors.length)) return;
    featureKeys.forEach((featureKey) => {
      writeHistoryPayload(historyRequestKey(kind, date, featureKey), payload);
    });
    if (!featureKeys.length) writeHistoryPayload(historyRequestKey(kind, date), payload);
  }

  async function prefetchSubscribedHistory() {
    if (prefetchRunning || navigator.onLine === false) return;
    // Visitors share the 'visitor' namespace of the history cache; accounts
    // each have their own, so sessions never read each other's archive.
    const identity = String(window.cidAuthCurrentUserId || '').trim() || 'visitor';
    const targets = prefetchTargets();
    if (!targets) return;
    const today = currentProgrammeDate();
    const tasks = [];
    dates().forEach((date) => {
      const tableauxKeys = targets.tableaux.filter((key) => (
        needsPrefetch('tableaux', date, key, today)
      ));
      // One Tableaux request returns every authorized programme for a date.
      if (tableauxKeys.length && typeof window.cidFetchTableauxForDate === 'function') {
        tasks.push({ kind: 'tableaux', date, featureKeys: targets.tableaux });
      }
      if (targets.matrix && needsPrefetch('matrix', date, '', today)) {
        tasks.push({ kind: 'matrix', date, featureKeys: [] });
      }
      if (targets.rejected && needsPrefetch('rejected', date, '', today)) {
        tasks.push({ kind: 'rejected', date, featureKeys: [] });
      }
    });
    const pending = tasks.filter((task) => {
      const id = `${identity}:${task.kind}:${task.date}:${task.featureKeys.join(',')}`;
      if (prefetchDone.has(id)) return false;
      prefetchDone.add(id);
      return true;
    });
    if (!pending.length) return;
    prefetchRunning = true;
    try {
      const worker = async () => {
        while (pending.length) {
          if (navigator.onLine === false
            || (String(window.cidAuthCurrentUserId || '').trim() || 'visitor') !== identity) return;
          const task = pending.shift();
          await runPrefetchTask(task).catch((error) => {
            prefetchDone.delete(`${identity}:${task.kind}:${task.date}:${task.featureKeys.join(',')}`);
            console.warn('Préchargement de l’historique impossible', task.kind, task.date, error);
          });
        }
      };
      await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
    } finally {
      prefetchRunning = false;
    }
  }

  function schedulePrefetch() {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
      const run = () => { void prefetchSubscribedHistory(); };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 5000 });
      } else {
        run();
      }
    }, PREFETCH_DELAY_MS);
  }

  window.addEventListener('cid:feature-access-changed', (event) => {
    if (event.detail) schedulePrefetch();
  });
  window.addEventListener('cid:feature-unlocked', schedulePrefetch);
  window.addEventListener('cid:subscription-unlocked', schedulePrefetch);
  window.addEventListener('online', schedulePrefetch);
  window.addEventListener('cid:supabase-ready', schedulePrefetch);
  // 16:00 UTC: the new publication enters the nine-entry window (the
  // programme clock has already pruned the date that left it).
  window.addEventListener('cid:programme-boundary', schedulePrefetch);
  window.addEventListener('cid:auth-sync', () => prefetchDone.clear());
  // The access state may already be known when this module loads (returning
  // subscriber): start the nine-day prefetch without waiting for an event.
  if (window.cidFeatureAccess?.state?.()) schedulePrefetch();

  window.cidShowPublicationHistory = show;
  window.cidPrefetchSubscribedHistory = prefetchSubscribedHistory;
})();
