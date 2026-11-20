import {
  historyCacheKey,
  readHistoryPayload,
  writeHistoryPayload
} from '/src/shared/history-cache.js?history-cache-v40';
import { invokeHistoryAccess } from '/src/services/history-api.js?history-api-v1';

/*
 * Paywalled historical archive reader.
 *
 * The Edge Function is the authority for the free window, the token price
 * and the active unlock. This module only renders the result and starts the
 * existing feature-unlock flow.
 */
(function initHistoryAccess() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const uiLocale = () => window.cidTranslation?.current?.() || 'fr';
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const DOMAIN_LABELS = {
    results: 'Résultats',
    cross: 'Croix nationale',
    matrix: 'Matrices',
    rejected: 'Boules rejetées'
  };
  const COUNTRY_NAMES = {
    BJ: 'Bénin',
    CI: "Côte d’Ivoire",
    GH: 'Ghana',
    GN: 'Guinée',
    NE: 'Niger',
    SN: 'Sénégal',
    TG: 'Togo'
  };
  const COUNTRY_OPTIONS = [
    { value: '', label: 'Tous' },
    { value: 'CI', label: "Côte d’Ivoire" },
    { value: 'NE', label: 'Niger' },
    { value: 'GH', label: 'Ghana' },
    { value: 'BJ', label: 'Bénin' },
    { value: 'SN', label: 'Sénégal' },
    { value: 'TG', label: 'Togo' },
    { value: 'GN', label: 'Guinée' }
  ];
  let state = null;
  let selectedDomain = 'results';
  let currentRows = [];
  let searchToken = 0;
  let countryOverride = null;
  let selectedDate = '';

  async function invoke(body) {
    return invokeHistoryAccess(body);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const date = new Date(`${value}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function normalizeCountry(value) {
    const normalized = String(value || '').trim().toLocaleLowerCase('fr-FR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === 'tous' || normalized === 'auto'
      || normalized.includes('tous les pays')) return '';
    const entry = COUNTRY_OPTIONS.find((option) => {
      const optionName = option.label.toLocaleLowerCase('fr-FR')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
      return option.value.toLocaleLowerCase() === normalized
        || optionName === normalized;
    });
    return entry?.value || String(value || '').trim().toUpperCase();
  }

  function detectedCountry() {
    const candidates = [
      window.cidSmartCountry?.get?.(),
      window.__cidUserCountry,
      window.cidAuth?.getCurrentProfile?.()?.country,
      (() => {
        try { return localStorage.getItem('firstVisitCountry'); } catch (_) { return ''; }
      })()
    ];
    return normalizeCountry(candidates.find((value) => value
      && normalizeCountry(value)) || '');
  }

  function countryLabel(value) {
    const code = normalizeCountry(value);
    return COUNTRY_NAMES[code] || code || 'Tous les pays';
  }

  function rowDate(row) {
    const value = selectedDomain === 'results'
      ? row?.draw_date
      : row?.programme_date;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
      ? String(value)
      : '';
  }

  function readableDate(value, options = {}) {
    if (!value) return 'Date inconnue';
    const date = new Date(`${value}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return 'Date inconnue';
    return date.toLocaleDateString(uiLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan',
      ...options
    });
  }

  function filterRowsForCountry(rows, countryCode) {
    if (!countryCode) return rows;
    if (selectedDomain === 'results') {
      return rows.filter((row) => String(row?.country_code || '').toUpperCase() === countryCode);
    }
    if (selectedDomain !== 'matrix') return rows;
    return rows.flatMap((row) => {
      const results = Array.isArray(row?.results) ? row.results : [];
      const filtered = results.filter((item) => {
        const value = String(item?.country_code || item?.country || item?.name || '');
        return normalizeCountry(value) === countryCode;
      });
      return filtered.length ? [{ ...row, results: filtered }] : [];
    });
  }

  function selectedRule() {
    return (state?.domains || []).find((item) => item.domain === selectedDomain) || null;
  }

  function formatNumbers(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (
          entry && typeof entry === 'object'
            ? Object.values(entry).filter((item) => item !== null && item !== undefined && item !== '').join(' · ')
            : entry
        ))
        .filter((entry) => entry !== null && entry !== undefined && String(entry).trim())
        .join(' · ') || '—';
    }
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim())
        .map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.join(' · ') : entry}`)
        .join(' · ') || '—';
    }
    return String(value ?? '').trim() || '—';
  }

  function hasHistoryValue(value) {
    if (Array.isArray(value)) {
      return value.some((entry) => hasHistoryValue(entry));
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some((entry) => hasHistoryValue(entry));
    }
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function historyValueLines(value) {
    const splitValue = (entry) => String(entry).trim()
      .split(/[\s,;·|/]+/)
      .filter(Boolean);
    if (Array.isArray(value)) {
      return value
        .flatMap((entry) => (
          entry && typeof entry === 'object'
            ? Object.values(entry)
            : [entry]
        ))
        .filter((entry) => hasHistoryValue(entry))
        .flatMap(splitValue);
    }
    if (value && typeof value === 'object') {
      return Object.values(value)
        .filter((entry) => hasHistoryValue(entry))
        .flatMap(splitValue);
    }
    return hasHistoryValue(value) ? splitValue(value) : [];
  }

  function verticalHistoryMarkup(value) {
    const values = historyValueLines(value);
    return values.length
      ? `<span class="cid-history-value-stack">${values.map((entry) => `<span>${escapeHtml(entry)}</span>`).join('')}</span>`
      : '';
  }

  function cleanMatrixProgramName(result, country, hour) {
    const name = String(result?.name || '')
      .replace(/\bSA\b/gi, '')
      .replace(/\bSoudji\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!name) return '';
    const normalizedName = name.toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');
    const normalizedCountry = String(country || '').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');
    const normalizedHour = String(hour || '').toLocaleLowerCase('fr-FR');
    return normalizedName === `${normalizedCountry} ${normalizedHour}`
      || normalizedName === `${normalizedCountry} · ${normalizedHour}`
      || normalizedName === `${normalizedCountry} • ${normalizedHour}`
      ? ''
      : name;
  }

  function matrixHistoryRows(rows) {
    return (Array.isArray(rows) ? rows : []).flatMap((archive) => {
      const results = Array.isArray(archive?.results) ? archive.results : [];
      return results.map((result) => {
        const country = result?.country || result?.name || '';
        const rawHour = result?.hour;
        const isNiger = String(country).toLocaleLowerCase('fr-FR') === 'niger';
        const numericHour = isNiger
          ? 14
          : rawHour === null
          || rawHour === undefined
          || String(rawHour).trim() === ''
          ? Number.NaN
          : Number(rawHour);
        const hour = Number.isFinite(numericHour)
          ? `${String(numericHour).padStart(2, '0')}h`
          : String(result?.draw_time || result?.drawTime || '').slice(0, 5)
            .replace(/^(\d{1,2}):(\d{2})$/, (_, hours, minutes) => (
              `${String(hours).padStart(2, '0')}h${minutes !== '00' ? minutes : ''}`
            ));
        return {
          programmeDate: archive?.programme_date || '',
          drawNumber: archive?.draw_number,
          country,
          hour,
          name: cleanMatrixProgramName(result, country, hour),
          matrix: result?.matrix,
          keyboard: result?.keyboard,
          cerveau: result?.cerveau,
          code: result?.code,
          event: result?.event
        };
      });
    });
  }

  function planFeatures(plan) {
    return Array.isArray(plan?.features)
      ? plan.features.map((feature) => String(feature || '').trim().toLowerCase())
      : [];
  }

  function planPrice(plan) {
    const label = String(plan?.price_label || plan?.priceLabel || '').trim();
    if (label) return label;
    const currency = String(plan?.unlock_currency || plan?.unlockCurrency || '').toLowerCase();
    const amount = Number(
      currency === 'tokens'
        ? plan?.required_tokens
        : plan?.required_stars
    );
    if (Number.isFinite(amount) && amount > 0) {
      const unit = currency === 'tokens'
        ? t('balance.tokenPlural', 'jetons')
        : t('balance.starPlural', 'étoiles');
      return `${amount.toLocaleString(uiLocale())} ${unit}`;
    }
    return t('history.configuredPrice', 'tarif configuré dans les offres');
  }

  async function renderBundleOptions(target) {
    if (!target) return;
    try {
      const access = await window.cidFeatureAccess?.preload?.();
      const plans = (Array.isArray(access?.plans) ? access.plans : [])
        .filter((plan) => plan?.enabled !== false)
        .filter((plan) => {
          const features = planFeatures(plan);
          return features.includes('historique-tous')
            || features.includes(selectedRule()?.featureKey)
            || features.includes(`historique-${selectedDomain}`);
        })
        .slice(0, 5);
      if (!plans.length) {
        target.innerHTML = '';
        return;
      }
      target.innerHTML = `
        <div class="cid-history-bundles">
          <strong>Forfaits configurés par l’administration</strong>
          <p>Vous pouvez aussi choisir un forfait global qui inclut cet historique.</p>
          <ul>${plans.map((plan) => `
            <li><span>${escapeHtml(plan.display_name || plan.name || plan.slug)}</span>
              <b>${escapeHtml(planPrice(plan))}</b></li>`).join('')}</ul>
          <button type="button" class="cid-history-offers-button" data-history-offers>
            Voir les offres
          </button>
        </div>`;
      target.querySelector('[data-history-offers]')?.addEventListener('click', () => {
        window.showOffersView?.();
      });
    } catch (_) {
      // The individual unlock remains usable if the public plan catalogue is
      // temporarily unavailable. Never invent a bundle or a price here.
      target.innerHTML = '';
    }
  }

  function renderLegacyRows(rows) {
    const target = get('cidHistoryResults');
    if (!target) return;
    if (!rows.length) {
      target.innerHTML = '<p class="cid-history-empty">Aucun résultat archivé pour cette période.</p>';
      return;
    }
    if (selectedDomain === 'results') {
      const columns = [
        ['draw_date', 'Date'],
        ['country_code', 'Pays'],
        ['draw_time', 'Heure'],
        ['draw_number', 'N° tirage'],
        ['first_numbers', 'Groupe 1'],
        ['machine_numbers', 'Groupe 2'],
        ['bonus_numbers', 'Bonus']
      ].filter(([key]) => rows.some((row) => hasHistoryValue(row[key])));
      if (!columns.length) {
        target.innerHTML = '<p class="cid-history-empty">Aucune donnée renseignée pour cette période.</p>';
        return;
      }
      target.innerHTML = `<div class="cid-history-table-wrap"><table class="cid-history-table">
        <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>
          ${columns.map(([key]) => {
            const value = key === 'country_code'
              ? COUNTRY_NAMES[row.country_code] || row.country_code
              : key === 'draw_time'
                ? String(row.draw_time || '').slice(0, 5)
                : row[key];
            return `<td>${escapeHtml(hasHistoryValue(value) ? formatNumbers(value) : '')}</td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
      return;
    }
    if (selectedDomain === 'cross') {
      const columns = [
        ['programme_date', 'Date'],
        ['generated_year', 'Année'],
        ['term', 'Terme'],
        ['assignment', 'Affectation'],
        ['signature', 'Signature']
      ].filter(([key]) => rows.some((row) => hasHistoryValue(row[key])));
      if (!columns.length) {
        target.innerHTML = '<p class="cid-history-empty">Aucune donnée renseignée pour cette période.</p>';
        return;
      }
      target.innerHTML = `<div class="cid-history-table-wrap"><table class="cid-history-table">
        <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>
          ${columns.map(([key]) => `<td>${escapeHtml(hasHistoryValue(row[key]) ? formatNumbers(row[key]) : '')}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
      return;
    }
    if (selectedDomain === 'matrix') {
      const matrixRows = matrixHistoryRows(rows);
      const columns = [
        ['programmeDate', 'Date', false],
        ['drawNumber', 'N° tirage', false],
        ['country', 'Pays', false],
        ['hour', 'Heure', false],
        ['name', 'Programme', false],
        ['matrix', 'Matrice', true],
        ['keyboard', 'Clavier', true],
        ['cerveau', 'Cerveau', true],
        ['code', 'Code', false],
        ['event', 'Événement', false]
      ].filter(([key]) => matrixRows.some((row) => hasHistoryValue(row[key])));
      if (!columns.length) {
        target.innerHTML = '<p class="cid-history-empty">Aucune donnée renseignée pour cette période.</p>';
        return;
      }
      target.innerHTML = `<div class="cid-history-table-wrap"><table class="cid-history-table">
        <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>${matrixRows.map((row) => `<tr>
          ${columns.map(([key, , vertical]) => {
            const value = row[key];
            if (vertical) return `<td>${verticalHistoryMarkup(value)}</td>`;
            return `<td>${escapeHtml(hasHistoryValue(value) ? formatNumbers(value) : '')}</td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
      return;
    }
    const rejectedColumns = [
      ['programme_date', 'Date'],
      ['finishes', 'Finitions'],
      ['groups', 'Groupes'],
      ['formatted_text', 'Texte archivé']
    ].filter(([key]) => rows.some((row) => hasHistoryValue(row[key])));
    if (!rejectedColumns.length) {
      target.innerHTML = '<p class="cid-history-empty">Aucune donnée renseignée pour cette période.</p>';
      return;
    }
    target.innerHTML = `<div class="cid-history-table-wrap"><table class="cid-history-table">
      <thead><tr>${rejectedColumns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>
        ${rejectedColumns.map(([key]) => {
          const value = row[key];
          if (!hasHistoryValue(value)) return '<td></td>';
          const text = value && typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
          return `<td><pre>${escapeHtml(text)}</pre></td>`;
        }).join('')}
      </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function archiveGroups(rows) {
    const groups = new Map();
    rows.map((row) => ({ row, date: rowDate(row) }))
      .filter(({ date }) => date)
      .forEach(({ row, date }) => {
        const [year, month] = date.split('-').map(Number);
        if (!groups.has(year)) groups.set(year, new Map());
        const months = groups.get(year);
        if (!months.has(month)) months.set(month, new Map());
        const days = months.get(month);
        if (!days.has(date)) days.set(date, []);
        days.get(date).push(row);
      });
    return [...groups.entries()]
      .sort(([left], [right]) => right - left)
      .map(([year, months]) => ({
        year,
        months: [...months.entries()]
          .sort(([left], [right]) => right - left)
          .map(([month, days]) => ({
            month,
            days: [...days.entries()].sort(([left], [right]) => right.localeCompare(left))
          }))
      }));
  }

  function dateCountLabel(count) {
    return `${count} archive${count > 1 ? 's' : ''}`;
  }

  function renderArchiveTree(rows) {
    const groups = archiveGroups(rows);
    if (!groups.length) {
      return '<p class="cid-history-empty">Aucune archive ne correspond à cette recherche.</p>';
    }
    return `
      <div class="cid-history-tree" aria-label="Archives classées par année et par mois">
        ${groups.map((yearGroup) => `
            <section class="cid-history-year" data-history-key="year:${escapeHtml(String(yearGroup.year))}">
            <div class="cid-history-year-heading">
              <span class="cid-history-year-mark">${escapeHtml(String(yearGroup.year).slice(-2))}</span>
              <h2>${yearGroup.year}</h2>
              <span>${yearGroup.months.length} mois</span>
            </div>
            <div class="cid-history-months">
              ${yearGroup.months.map((monthGroup, monthIndex) => {
                const monthDate = new Date(Date.UTC(yearGroup.year, monthGroup.month - 1, 1, 12));
                const monthLabel = monthDate.toLocaleDateString(uiLocale(), {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'Africa/Abidjan'
                });
                const monthRows = monthGroup.days.reduce((total, [, dayRows]) => total + dayRows.length, 0);
                return `
                  <details
                    class="cid-history-month"
                    data-history-key="month:${escapeHtml(`${yearGroup.year}-${String(monthGroup.month).padStart(2, '0')}`)}"
                    ${monthIndex === 0 ? 'open' : ''}>
                    <summary>
                      <span class="cid-history-folder-icon" aria-hidden="true">▱</span>
                      <span class="cid-history-month-copy">
                        <strong>${escapeHtml(monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1))}</strong>
                        <small>${monthGroup.days.length} date${monthGroup.days.length > 1 ? 's' : ''} · ${dateCountLabel(monthRows)}</small>
                      </span>
                      <span class="cid-history-chevron" aria-hidden="true">⌄</span>
                    </summary>
                    <div class="cid-history-days">
                      ${monthGroup.days.map(([date, dayRows]) => `
                        <button
                          type="button"
                          class="cid-history-day"
                          data-history-key="date:${escapeHtml(date)}"
                          data-history-open-date="${escapeHtml(date)}">
                          <span class="cid-history-day-number">${Number(date.slice(8, 10))}</span>
                          <span class="cid-history-day-copy">
                            <strong>${escapeHtml(readableDate(date, { weekday: 'long' }))}</strong>
                            <small>${dateCountLabel(dayRows.length)} · ouvrir la publication</small>
                          </span>
                          <span class="cid-history-day-arrow" aria-hidden="true">→</span>
                        </button>`).join('')}
                    </div>
                  </details>`;
              }).join('')}
            </div>
          </section>`).join('')}
      </div>
      ${selectedDomain === 'results'
        ? '<section class="cid-history-selection" data-history-selection hidden aria-live="polite"></section>'
        : ''}
    `;
  }

  function renderResultSelection(target, date) {
    const selection = target?.querySelector('[data-history-selection]');
    if (!selection) return;
    const rows = currentRows.filter((row) => rowDate(row) === date);
    if (!rows.length) {
      selection.hidden = true;
      selection.replaceChildren();
      return;
    }
    selection.hidden = false;
    selection.innerHTML = `
      <div class="cid-history-selection-heading">
        <div>
          <span class="cid-history-section-kicker">Publication sélectionnée</span>
          <h2>${escapeHtml(readableDate(date, { weekday: 'long' }))}</h2>
        </div>
        <button type="button" class="cid-history-selection-close" data-history-close-selection aria-label="Fermer">×</button>
      </div>
      <div class="cid-history-result-cards">
        ${rows.map((row, index) => `
          <article
            class="resultat-aide-draw-card cid-history-result-card"
            data-history-key="result:${escapeHtml(
              `${row.id || row.draw_id || row.programme_date || date}:${row.country_code || row.country || index}`
            )}">
            <div class="resultat-aide-draw-card-heading">
              <strong>${escapeHtml(countryLabel(row.country_code))}</strong>
              <span>${escapeHtml(String(row.draw_time || '').slice(0, 5) || '—')}</span>
            </div>
            <div class="cid-history-result-line">
              <span>Groupe 1</span><b>${escapeHtml(formatNumbers(row.first_numbers))}</b>
            </div>
            <div class="cid-history-result-line">
              <span>Groupe 2</span><b>${escapeHtml(formatNumbers(row.machine_numbers))}</b>
            </div>
            ${hasHistoryValue(row.bonus_numbers) ? `
              <div class="cid-history-result-line">
                <span>Bonus</span><b>${escapeHtml(formatNumbers(row.bonus_numbers))}</b>
              </div>` : ''}
          </article>`).join('')}
      </div>
      <button type="button" class="cid-history-native-link" data-history-open-results>
        Ouvrir la vue Résultats
      </button>`;
    selection.querySelector('[data-history-close-selection]')?.addEventListener('click', () => {
      selection.hidden = true;
    });
    selection.querySelector('[data-history-open-results]')?.addEventListener('click', () => {
      window.showResultatAideView?.();
    });
  }

  function openArchiveDate(target, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
    selectedDate = String(date).slice(0, 10);
    const historyHost = get('historyViewMount');
    if (historyHost) historyHost.dataset.selectedDate = selectedDate;
    window.__cidSelectedHistoryDate = selectedDate;
    window.__cidActiveProgrammeDate = selectedDate;
    if (selectedDomain === 'cross') {
      window.showCroixView?.({ date: selectedDate });
      return;
    }
    if (selectedDomain === 'matrix') {
      window.showMatriceView?.({ date: selectedDate });
      return;
    }
    if (selectedDomain === 'rejected') {
      window.showRejectedView?.({ date: selectedDate });
      return;
    }
    renderResultSelection(target, selectedDate);
  }

  function copyHistoryAttributes(current, next) {
    const preservedOpen = current instanceof HTMLDetailsElement && current.open;
    Array.from(current.attributes).forEach((attribute) => {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    });
    Array.from(next.attributes).forEach((attribute) => {
      current.setAttribute(attribute.name, attribute.value);
    });
    if (preservedOpen && current instanceof HTMLDetailsElement) current.open = true;
  }

  /*
   * Reconcile keyed archive nodes in place. Search responses may arrive out
   * of order, but an existing year/month/date node keeps its DOM identity
   * and its scroll/open state. Only genuinely new keys are inserted.
   */
  function reconcileHistoryNode(current, next) {
    copyHistoryAttributes(current, next);
    const hasNestedKeys = Boolean(next.querySelector('[data-history-key]'));
    if (!hasNestedKeys) {
      current.replaceChildren(...Array.from(next.childNodes).map((node) => node.cloneNode(true)));
      return;
    }
    const currentChildren = Array.from(current.children);
    const used = new Set();
    Array.from(next.children).forEach((nextChild, index) => {
      const nextKey = nextChild.dataset.historyKey || '';
      let match = nextKey
        ? currentChildren.find((candidate) => (
          !used.has(candidate) && candidate.dataset.historyKey === nextKey
        ))
        : currentChildren.find((candidate) => (
          !used.has(candidate)
          && candidate.tagName === nextChild.tagName
          && candidate.className === nextChild.className
        )) || currentChildren[index];
      if (match && match.parentNode === current) {
        used.add(match);
        reconcileHistoryNode(match, nextChild);
        if (match !== current.children[index]) {
          current.insertBefore(match, current.children[index] || null);
        }
      } else {
        const clone = nextChild.cloneNode(true);
        current.insertBefore(clone, current.children[index] || null);
        used.add(clone);
      }
    });
    currentChildren.forEach((child) => {
      if (!used.has(child)) child.remove();
    });
  }

  function reconcileHistoryMarkup(target, markup) {
    const template = document.createElement('div');
    template.innerHTML = markup;
    const nextRoot = template.firstElementChild;
    const currentRoot = target.firstElementChild;
    if (!nextRoot || !currentRoot || nextRoot.tagName !== currentRoot.tagName
      || nextRoot.className !== currentRoot.className) {
      target.replaceChildren(nextRoot || document.createTextNode(''));
      return;
    }
    reconcileHistoryNode(currentRoot, nextRoot);
  }

  function bindHistoryDateButtons(target) {
    target.querySelectorAll('[data-history-open-date]').forEach((button) => {
      if (button.dataset.historyBound === 'true') return;
      button.dataset.historyBound = 'true';
      button.addEventListener('click', () => openArchiveDate(
        target,
        button.dataset.historyOpenDate || ''
      ));
    });
  }

  function renderRows(rows) {
    const target = get('cidHistoryResults');
    if (!target) return;
    selectedDate = '';
    get('historyViewMount')?.removeAttribute('data-selected-date');
    delete window.__cidSelectedHistoryDate;
    currentRows = filterRowsForCountry(Array.isArray(rows) ? rows : [], selectedCountryCode());
    reconcileHistoryMarkup(target, renderArchiveTree(currentRows));
    bindHistoryDateButtons(target);
  }

  function setStatus(message, kind = '') {
    const status = get('cidHistoryStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = `cid-history-status${kind ? ` is-${kind}` : ''}`;
  }

  function searchCacheKey(fromDate, toDate, countryCode) {
    return historyCacheKey({
      kind: 'history-search',
      featureKey: `${selectedDomain}:${countryCode || 'all'}:${fromDate || 'start'}:${toDate || 'today'}`,
      // historyCacheKey intentionally normalizes dates. The complete range is
      // part of featureKey so two searches can never overwrite each other.
      date: 'range'
    });
  }

  function lastSearchCacheKey(countryCode) {
    return historyCacheKey({
      kind: 'history-search-last',
      featureKey: `${selectedDomain}:${countryCode || 'all'}`,
      date: 'last'
    });
  }

  function selectedCountryCode() {
    return normalizeCountry(get('cidHistoryCountry')?.value || '');
  }

  function renderCountryOptions() {
    const select = get('cidHistoryCountry');
    if (!select) return;
    const activeCountry = detectedCountry();
    select.innerHTML = COUNTRY_OPTIONS.map((option) => {
      const label = option.value && option.value === activeCountry
        ? `Auto · ${option.label}`
        : option.label;
      return `<option value="${escapeHtml(option.value)}">${escapeHtml(label)}</option>`;
    }).join('');
    const selected = countryOverride === null ? activeCountry : countryOverride;
    select.value = selected;
    select.dataset.detected = activeCountry;
    const hint = get('cidHistoryCountryHint');
    if (hint) {
      hint.textContent = selected
        ? (countryOverride === null
          ? `Pays actif détecté : ${countryLabel(activeCountry)}`
          : `Filtre choisi : ${countryLabel(selected)}`)
        : 'Tous les pays sont affichés';
    }
  }

  function initialiseDateFilters() {
    const rule = selectedRule();
    const from = get('cidHistoryFrom');
    const to = get('cidHistoryTo');
    if (!from || !to) return;
    const end = today();
    if (!to.value) to.value = end;
    if (!from.value) {
      const freeDays = Math.max(0, Number(rule?.freeDays) || 0);
      from.value = addDays(end, -freeDays);
    }
  }

  function renderUnlockPrompt(payload) {
    const target = get('cidHistoryResults');
    if (!target) return;
    const rule = payload.rule || selectedRule() || {};
    const cost = rule.currency === 'stars'
      ? `${rule.requiredStars || 0} étoiles`
      : `${rule.requiredTokens || 0} jeton(s)`;
    target.innerHTML = `
      <section class="cid-history-unlock">
        <strong>Historique au-delà de la période gratuite</strong>
        <p>La période gratuite se termine le <b>${escapeHtml(payload.cutoffDate || '—')}</b>.</p>
        <p>Voulez-vous débloquer uniquement ${escapeHtml(rule.displayName || DOMAIN_LABELS[selectedDomain])} pour ${escapeHtml(cost)} pendant ${Number(rule.durationDays) || 30} jour(s) ?</p>
        <button type="button" class="cid-history-unlock-button" data-cid-history-unlock>
          Débloquer uniquement cet historique
        </button>
        <div data-history-bundles></div>
      </section>`;
    renderBundleOptions(target.querySelector('[data-history-bundles]'));
    target.querySelector('[data-cid-history-unlock]')?.addEventListener('click', async () => {
      const button = target.querySelector('[data-cid-history-unlock]');
      if (button) button.disabled = true;
      try {
        const result = await window.cidUnlockFeature?.(
          rule.featureKey,
          {
            label: rule.displayName || DOMAIN_LABELS[selectedDomain],
            currency: rule.currency,
            requiredTokens: rule.requiredTokens,
            requiredStars: rule.requiredStars
          }
        );
        if (!result?.ok) {
          if (result?.requiresAuth) {
            window.showProfileView?.({ updateHistory: true });
          }
          setStatus(result?.error || 'Le déblocage n’a pas été effectué.', 'error');
          if (button) button.disabled = false;
          return;
        }
        setStatus('Historique débloqué. Chargement des archives…', 'success');
        await search();
      } catch (error) {
        setStatus(error?.message || 'Le déblocage est indisponible.', 'error');
        if (button) button.disabled = false;
      }
    });
  }

  async function search() {
    const fromDate = String(get('cidHistoryFrom')?.value || '').trim();
    const toDate = String(get('cidHistoryTo')?.value || '').trim();
    const countryCode = selectedCountryCode();
    const request = ++searchToken;
    if (fromDate && toDate && fromDate > toDate) {
      setStatus('La date de début doit précéder la date de fin.', 'error');
      return;
    }
    if (!get('cidHistoryResults')) return;
    const cacheKey = searchCacheKey(fromDate, toDate, countryCode);
    const cached = readHistoryPayload(cacheKey)
      || readHistoryPayload(lastSearchCacheKey(countryCode));
    if (Array.isArray(cached?.value?.rows)) {
      // Paint the last valid result before the network request. The existing
      // archive stays visible while a refresh is in flight.
      renderRows(cached.value.rows);
      setStatus('Actualisation en arrière-plan…', 'loading');
    } else {
      /*
       * The first visit gets a local skeleton. Once a tree exists, keep it
       * visible and report the refresh in the status line instead of
       * clearing the user's current archive while the request is pending.
       */
      const target = get('cidHistoryResults');
      if (!target.querySelector('[data-history-key]')) {
        const loader = document.createElement('div');
        loader.className = 'cid-history-loading';
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        loader.innerHTML = '<span>Actualisation des archives…</span>';
        target.replaceChildren(loader);
      }
    }
    if (!cached?.value?.rows) setStatus('Recherche des archives…');
    try {
      const result = await invoke({
        action: 'search',
        domain: selectedDomain,
        fromDate,
        toDate,
        countryCode
      });
      if (request !== searchToken) return;
      if (result.configured === false) {
        if (!cached?.value?.rows) renderRows([]);
        setStatus(result.error || 'Cet historique n’est pas encore configuré par l’administration.', 'warning');
        return;
      }
      if (result.requiresUnlock) {
        if (cached?.value?.rows) {
          setStatus(
            'Dernières archives conservées. Les archives plus anciennes nécessitent un déblocage.',
            'warning'
          );
        } else {
          renderUnlockPrompt(result);
          setStatus('Un déblocage est nécessaire pour cette période.', 'warning');
        }
        return;
      }
      const rows = Array.isArray(result.rows) ? result.rows : [];
      const cachedValue = {
        rows,
        from: result.from || fromDate,
        to: result.to || toDate,
        domain: selectedDomain,
        countryCode
      };
      writeHistoryPayload(cacheKey, cachedValue);
      writeHistoryPayload(lastSearchCacheKey(countryCode), cachedValue);
      renderRows(rows);
      setStatus(
        `${currentRows.length} archive(s) · ${result.from || fromDate || 'début'} → ${result.to || toDate || today()}`,
        'success'
      );
    } catch (error) {
      if (request !== searchToken) return;
      setStatus(error?.message || 'Historique indisponible.', 'error');
    }
  }

  window.cidHistoryChatLookup = async (params = {}) => invoke({
    action: 'search',
    domain: params.domain,
    fromDate: params.fromDate || '',
    toDate: params.toDate || '',
    countryCode: normalizeCountry(params.countryCode || '')
  });

  async function loadState() {
    try {
      state = await invoke({ action: 'state' });
    } catch (error) {
      setStatus(error?.message || 'Configuration historique indisponible.', 'error');
    }
  }

  function render() {
    const panel = get('historyViewMount');
    if (!panel) return;
    if (panel.dataset.ready === 'true') {
      renderCountryOptions();
      initialiseDateFilters();
      // Paint a matching local result immediately; state/access refreshes in
      // parallel and performs the authoritative search afterwards.
      void search();
      void loadState().then(() => {
        initialiseDateFilters();
        search();
      });
      return;
    }
    panel.dataset.ready = 'true';
    panel.innerHTML = `
      <div class="cid-history-panel">
        <header class="cid-history-header">
          <div>
            <span class="cid-history-eyebrow">Archives consultables</span>
            <h1>Historique</h1>
            <p>Les périodes récentes restent accessibles selon la configuration publique. Les archives plus anciennes sont débloquées domaine par domaine.</p>
          </div>
        </header>
        <div class="cid-history-domains" role="tablist">
          ${Object.entries(DOMAIN_LABELS).map(([key, label]) => `<button type="button" class="cid-history-domain${key === selectedDomain ? ' is-active' : ''}" data-history-domain="${key}">${label}</button>`).join('')}
        </div>
        <div class="cid-history-filters">
          <label class="cid-history-country-field">
            Pays / code
            <select id="cidHistoryCountry" aria-describedby="cidHistoryCountryHint"></select>
            <small id="cidHistoryCountryHint" class="cid-history-field-hint"></small>
          </label>
          <label>Du<input id="cidHistoryFrom" type="date"></label>
          <label>Au<input id="cidHistoryTo" type="date"></label>
          <button type="button" class="cid-history-search" data-history-search>Rechercher</button>
        </div>
        <p id="cidHistoryStatus" class="cid-history-status" role="status"></p>
        <div id="cidHistoryResults" class="cid-history-results">
          <div class="cid-history-loading" role="status" aria-live="polite">
            <span>Chargement des archives…</span>
          </div>
        </div>
      </div>`;
    panel.querySelectorAll('[data-history-domain]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedDomain = button.dataset.historyDomain || 'results';
        panel.querySelectorAll('[data-history-domain]').forEach((item) => {
          item.classList.toggle('is-active', item === button);
        });
        search();
      });
    });
    panel.querySelector('[data-history-search]')?.addEventListener('click', search);
    panel.querySelector('#cidHistoryCountry')?.addEventListener('change', () => {
      countryOverride = get('cidHistoryCountry')?.value || '';
      renderRows(currentRows);
      search();
    });
    panel.querySelectorAll('#cidHistoryFrom, #cidHistoryTo').forEach((input) => {
      input.addEventListener('change', search);
    });
    window.addEventListener('cid:country-change', () => {
      renderCountryOptions();
      search();
    });
    renderCountryOptions();
    initialiseDateFilters();
    void search();
    void loadState().then(() => {
      initialiseDateFilters();
      renderCountryOptions();
      search();
    });
  }

  window.cidShowHistory = render;
})();
