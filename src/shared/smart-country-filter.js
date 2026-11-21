/* Smart Country Filter
 *
 * This is an adapter layer. It does not alter the existing calculators,
 * renderers, matrices, Croix logic, or rejected-ball algorithms. It only:
 *   1. stores the visitor's country preference beside the existing profile;
 *   2. invokes the existing Matrix country selector;
 *   3. applies a visibility condition to already-rendered rejected groups;
 *   4. adds an explicit escape hatch back to the existing all-country view;
 *   5. emits the preference change so the Accueil feed can reorder itself.
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'cidgroup.smart-country.v1';
  const PENDING_KEY = 'cidgroup.smart-country.pending.v1';
  const COUNTRY_OPTIONS = [
    { value: 'Tous', label: 'Auto / Tous les pays' },
    { value: "Côte d'Ivoire", label: "Côte d'Ivoire" },
    { value: 'Niger', label: 'Niger' },
    { value: 'Ghana', label: 'Ghana' },
    { value: 'Bénin', label: 'Bénin' },
    { value: 'Sénégal', label: 'Sénégal' },
    { value: 'Togo', label: 'Togo' }
  ];

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const ti = (key, values = {}, fallback = key) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
    t(key, fallback)
  );

  let matrixViewToken = 0;
  let matrixWasActive = false;
  let matrixAutoApplied = '';
  let matrixManualOverride = false;
  let rejectedGlobalOverride = false;
  let rejectedRoot = null;
  let applyingMatrix = false;

  /*
   * Idempotent DOM writes. refreshAdapters() is driven by a MutationObserver
   * on <body>: writing an identical value still queues a mutation, which
   * re-scheduled refreshAdapters() every 70 ms forever. That loop made the
   * Boules rejetées / Matrice toolbars and groups tremble and blink. Only
   * touch the DOM when the visible value actually changes.
   */
  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };
  const setHtml = (element, value) => {
    if (!element || element.dataset.smartHtml === value) return;
    element.innerHTML = value;
    element.dataset.smartHtml = value;
  };
  const setAttr = (element, name, value) => {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  const setHidden = (element, hidden) => {
    if (!element) return;
    if (element.hidden !== hidden) element.hidden = hidden;
    setAttr(element, 'aria-hidden', String(hidden));
  };

  const normalize = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Preference persistence is optional; the adapter still works in memory.
    }
  };

  const getProfile = () => {
    try {
      return window.cidAuth?.getCurrentProfile?.() || null;
    } catch {
      return null;
    }
  };

  const countryFromLabel = (value) => {
    const target = normalize(value);
    if (!target || target === 'auto' || target === 'tous' || target === 'tous les pays') return 'Tous';
    const match = COUNTRY_OPTIONS.find(option => normalize(option.value) === target);
    // Keep administrator-added countries instead of collapsing them to
    // "Tous". The Matrix selector can expose countries dynamically.
    return match ? match.value : String(value || '').trim();
  };

  const countryMatches = (label, country) => {
    if (!country || country === 'Tous') return true;
    const wanted = normalize(country);
    const actual = normalize(label);
    return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
  };

  const profileCountry = () => {
    const profile = getProfile();
    const stored = read(STORAGE_KEY, {});
    if (profile?.cid && stored.byCid?.[profile.cid]) {
      return countryFromLabel(stored.byCid[profile.cid]);
    }
    // An old anonymous "Tous" value must not mask a newer first-visit
    // selection. This keeps anonymous visitors in sync with the home feed.
    if (stored.anonymous) {
      const anonymousCountry = countryFromLabel(stored.anonymous);
      if (anonymousCountry !== 'Tous') return anonymousCountry;
    }

    const firstVisit = localStorage.getItem('firstVisitCountry');
    return countryFromLabel(firstVisit);
  };

  const saveCountry = (country, source = 'profile') => {
    const normalizedCountry = countryFromLabel(country);
    const profile = getProfile();
    const stored = read(STORAGE_KEY, { byCid: {}, anonymous: 'Tous' });
    stored.byCid = stored.byCid || {};
    if (profile?.cid) stored.byCid[profile.cid] = normalizedCountry;
    else stored.anonymous = normalizedCountry;
    stored.updatedAt = new Date().toISOString();
    stored.source = source;
    write(STORAGE_KEY, stored);

    // Keep the already-existing first-visit preference in sync without
    // changing its modal/controller implementation.
    try { localStorage.setItem('firstVisitCountry', normalizedCountry); } catch {}
    window.__cidUserCountry = normalizedCountry;
    window.dispatchEvent(new CustomEvent('cid:country-change', {
      detail: { country: normalizedCountry, cid: profile?.cid || null, source }
    }));
  };

  const selectedOptions = (selected) => {
    const known = COUNTRY_OPTIONS.some(
      (option) => normalize(option.value) === normalize(selected)
    );
    const custom = selected && selected !== 'Tous' && !known
      ? [{ value: selected, label: selected }]
      : [];
    return [...custom, ...COUNTRY_OPTIONS].map(option =>
      `<option value="${option.value}"${option.value === selected ? ' selected' : ''}>${option.label}</option>`
    ).join('');
  };

  const makeCountrySelect = (id, selected) => {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'cid-smart-country-select';
    select.setAttribute('aria-label', t('smart.customCountry', 'Pays du programme personnalisé'));
    select.innerHTML = selectedOptions(selected);
    select.value = selected;
    return select;
  };

  function ensureSignupCountryField() {
    const form = document.getElementById('signupForm');
    if (!form || document.getElementById('cid-smart-signup-country')) return;

    const card = document.createElement('div');
    card.className = 'cid-smart-country-card';
    card.id = 'cid-smart-signup-country-card';
    card.innerHTML = `
      <label for="cid-smart-signup-country">${t('smart.customCountry', 'Pays du programme personnalisé')}</label>
      <p class="cid-smart-country-help">${t('smart.customCountryHelp', 'Ce choix sert uniquement à présélectionner vos programmes.')}</p>
    `;
    const select = makeCountrySelect('cid-smart-signup-country', profileCountry());
    card.appendChild(select);
    form.appendChild(card);
    select.addEventListener('change', () => write(PENDING_KEY, { country: select.value, updatedAt: new Date().toISOString() }));
  }

  function ensureProfileCountryField() {
    const profileView = document.querySelector('#profileViewContainer #profileView');
    if (!profileView) return;
    const existingCard = document.getElementById('cid-smart-profile-country-card');
    if (existingCard) {
      const existingSelect = document.getElementById('cid-smart-profile-country');
      if (existingSelect && document.activeElement !== existingSelect) {
        existingSelect.value = profileCountry();
      }
      return;
    }

    const card = document.createElement('div');
    card.id = 'cid-smart-profile-country-card';
    card.className = 'cid-smart-country-card';
    card.innerHTML = `
      <strong>${t('smart.customCountry', 'Pays du programme personnalisé')}</strong>
      <p class="cid-smart-country-help">${t('smart.profileHelp', 'Les vues Matrice et Boules rejetées utiliseront ce pays par défaut.')}</p>
    `;
    const select = makeCountrySelect('cid-smart-profile-country', profileCountry());
    card.appendChild(select);
    const status = document.createElement('p');
    status.className = 'cid-smart-country-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    card.appendChild(status);

    const anchor = profileView.querySelector('.profile-heading, .identity-card');
    if (anchor?.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
    else profileView.prepend(card);

    select.addEventListener('change', () => {
      saveCountry(select.value, 'profile');
      status.textContent = select.value === 'Tous'
        ? 'Filtre automatique désactivé.'
        : `Pays enregistré : ${select.value}.`;
    });
  }

  function syncPendingCountry() {
    const pending = read(PENDING_KEY, null);
    if (!pending?.country) return;
    const profile = getProfile();
    if (!profile?.cid) return;
    saveCountry(pending.country, 'signup');
    try { localStorage.removeItem(PENDING_KEY); } catch {}
  }

  function captureFirstVisitCountry() {
    const select = document.getElementById('fvCountry');
    if (select?.value) saveCountry(select.value, 'first-visit');
  }

  function matrixIsActive() {
    return document.body.classList.contains('matrice-active') ||
      String(window.__currentCategory || '').toLocaleLowerCase('fr-FR') === 'matrice';
  }

  function resetMatrixEntryState() {
    if (!matrixIsActive()) {
      matrixWasActive = false;
      matrixAutoApplied = '';
      matrixManualOverride = false;
      return;
    }
    if (!matrixWasActive) {
      matrixViewToken += 1;
      matrixAutoApplied = '';
      matrixManualOverride = false;
      matrixWasActive = true;
    }
  }

  function applyMatrixCountry() {
    resetMatrixEntryState();
    if (!matrixIsActive() || matrixManualOverride) return;
    const country = profileCountry();
    if (!country || country === 'Tous') return;

    const button = $$('#countryButtons .country-filter-btn')
      .find(item => countryMatches(item.dataset.country, country));
    if (!button) return;

    const token = `${matrixViewToken}:${country}`;
    const alreadySelected = button.classList.contains('active') ||
      button.getAttribute('aria-pressed') === 'true';
    if (matrixAutoApplied === token && alreadySelected) return;
    applyingMatrix = true;
    try {
      if (typeof window.selectMatriceCountry === 'function') {
        window.selectMatriceCountry(button.dataset.country);
      } else {
        button.click();
      }
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      matrixAutoApplied = token;
    } finally {
      setTimeout(() => { applyingMatrix = false; }, 0);
    }
  }

  /*
   * One click = one state change. The button used to force "Tous" on every
   * click, even while it read "Revenir au programme {{country}}", so a tap
   * re-rendered the same list again instead of returning to the profile
   * country. It now toggles between the two views, ignores taps while the
   * previous switch is still rendering, and keeps the button on screen.
   */
  let matrixSwitchPending = false;
  let pendingMatrixAnchor = null;
  function matrixOtherCountries(event) {
    if (matrixSwitchPending) return;
    const country = profileCountry();
    const backToCountry = Boolean(matrixManualOverride && country && country !== 'Tous');
    const target = backToCountry
      ? $$('#countryButtons .country-filter-btn')
        .find(item => countryMatches(item.dataset.country, country))?.dataset.country
      : 'Tous';
    if (!target) return;
    matrixSwitchPending = true;
    window.setTimeout(() => { matrixSwitchPending = false; }, 400);
    matrixManualOverride = !backToCountry;
    if (backToCountry) matrixAutoApplied = `${matrixViewToken}:${country}`;
    const anchorTop = event?.currentTarget?.getBoundingClientRect?.().top;
    pendingMatrixAnchor = Number.isFinite(anchorTop) ? anchorTop : null;
    applyingMatrix = true;
    try {
      if (typeof window.selectMatriceCountry === 'function') {
        window.selectMatriceCountry(target);
      } else {
        $$('#countryButtons .country-filter-btn')
          .find(button => normalize(button.dataset.country) === normalize(target))
          ?.click();
      }
    } finally {
      setTimeout(() => { applyingMatrix = false; }, 0);
    }
    ensureMatrixOtherCountriesButton();
  }

  /*
   * After the level is rebuilt, keep the toolbar button at the same place on
   * screen: the list grows or shrinks around it, the button does not jump.
   */
  function restoreMatrixAnchor() {
    if (pendingMatrixAnchor == null) return;
    const button = document.querySelector('[data-smart-country-other="matrix"]');
    const scroller = document.getElementById('results');
    if (!button || !scroller) return;
    const delta = button.getBoundingClientRect().top - pendingMatrixAnchor;
    pendingMatrixAnchor = null;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
  }

  function ensureMatrixOtherCountriesButton() {
    const level = document.querySelector('.matrix-level-two');
    if (!level) return;

    let toolbar = level.querySelector('[data-smart-country-toolbar="matrix"]');
    let copy;
    let button;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'cid-smart-toolbar';
      toolbar.dataset.smartCountryToolbar = 'matrix';
      copy = document.createElement('div');
      copy.className = 'cid-smart-toolbar-copy';
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'cid-smart-other-button';
      button.dataset.smartCountryOther = 'matrix';
      button.addEventListener('click', matrixOtherCountries);
      toolbar.append(copy, button);
      level.appendChild(toolbar);
    } else {
      copy = toolbar.querySelector('.cid-smart-toolbar-copy');
      button = toolbar.querySelector('[data-smart-country-other="matrix"]');
    }

    const country = profileCountry();
    setHtml(copy, country !== 'Tous'
      ? `<strong>${ti('smart.customProgram', { country }, 'Programme personnalisé : {{country}}')}</strong><span>${t('smart.matrixFiltered', 'La matrice est filtrée par votre pays.')}</span>`
      : `<strong>${t('smart.globalProgram', 'Programme global')}</strong><span>${t('smart.allCountries', 'Tous les pays sont disponibles.')}</span>`);
    if (button) {
      const hasCountry = Boolean(country && country !== 'Tous');
      setHidden(button, !hasCountry);
      setText(button, matrixManualOverride
        ? `🌍 ${ti('smart.backToProgram', { country }, 'Revenir au programme {{country}}')}`
        : `🌍 ${t('smart.otherCountries', 'Voir le programme des autres pays')}`);
    }
  }

  function rejectedRootElement() {
    const inline = document.getElementById('rejectedInlineMain');
    if (inline?.isConnected && inline.querySelector('.circle-cell')) return inline;
    return (
      document.getElementById('rejectedModal')?.classList.contains('open')
        ? document.getElementById('rejectedContent')
        : null
    );
  }

  function rejectedGroups(root) {
    if (!root) return [];
    const cards = $$('.rejected-country-card', root)
      .filter(group => group.querySelector('.circle-cell'));
    if (cards.length) return cards;
    return $$('.rejected-balls-container', root)
      .filter(group => group.querySelector('.circle-cell'));
  }

  function rejectedGroupLabel(group) {
    const heading = $('.rejected-balls-title', group) ||
      $('.rejected-balls-title-row > :first-child', group) ||
      group.firstElementChild?.firstElementChild;
    return heading?.textContent?.replace(/Copier/gi, '').trim() ||
      group.textContent.trim().slice(0, 80);
  }

  function filterRejectedGroups(root) {
    const groups = rejectedGroups(root);
    const country = profileCountry();
    const showAll = rejectedGlobalOverride || !country || country === 'Tous';
    groups.forEach(group => {
      const visible = showAll || countryMatches(rejectedGroupLabel(group), country);
      if (group.dataset.smartHidden !== String(!visible)) {
        group.dataset.smartHidden = String(!visible);
      }
      setAttr(group, 'aria-hidden', String(!visible));
      if (!group.classList.contains('cid-smart-rejected-group')) {
        group.classList.add('cid-smart-rejected-group');
      }
    });
    return groups;
  }

  let rejectedSwitchAt = 0;
  function rejectedOtherCountries(event) {
    // A double tap (or a ghost click on mobile) must not toggle twice.
    const now = Date.now();
    if (now - rejectedSwitchAt < 350) return;
    rejectedSwitchAt = now;
    const clicked = event?.currentTarget;
    const anchorTop = clicked?.getBoundingClientRect?.().top;
    rejectedGlobalOverride = !rejectedGlobalOverride;
    const root = rejectedRootElement();
    filterRejectedGroups(root);
    const button = root?.querySelector('[data-smart-country-other="rejected"]');
    const country = profileCountry();
    setText(button, rejectedGlobalOverride
      ? `🌍 ${ti('smart.backToRejected', { country }, 'Revenir aux boules {{country}}')}`
      : `🌍 ${t('smart.otherRejected', 'Voir les boules rejetées des autres pays')}`);
    // Keep the button where the finger is: the list opens around it.
    const scroller = root?.closest?.('#results');
    if (button && scroller && Number.isFinite(anchorTop)) {
      const delta = button.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    }
  }

  function ensureRejectedToolbar(root) {
    if (!root) return;
    let toolbar = root.querySelector('[data-smart-country-toolbar="rejected"]');
    let copy;
    let button;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'cid-smart-toolbar';
      toolbar.dataset.smartCountryToolbar = 'rejected';
      copy = document.createElement('div');
      copy.className = 'cid-smart-toolbar-copy';
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'cid-smart-other-button';
      button.dataset.smartCountryOther = 'rejected';
      button.addEventListener('click', rejectedOtherCountries);
      toolbar.append(copy, button);
    } else {
      copy = toolbar.querySelector('.cid-smart-toolbar-copy');
      button = toolbar.querySelector('[data-smart-country-other="rejected"]');
    }

    const country = profileCountry();
    setHtml(copy, country !== 'Tous'
      ? `<strong>${ti('smart.customRejected', { country }, 'Boules rejetées personnalisées : {{country}}')}</strong><span>${t('smart.existingMethod', 'La méthode existante est conservée, seul l’affichage est filtré.')}</span>`
      : `<strong>${t('smart.globalRejected', 'Boules rejetées globales')}</strong><span>${t('smart.allDisplayed', 'Tous les pays sont affichés.')}</span>`);
    if (button) {
      const hasCountry = Boolean(country && country !== 'Tous');
      setHidden(button, !hasCountry);
      setText(button, rejectedGlobalOverride
        ? `🌍 ${ti('smart.backToRejected', { country }, 'Revenir aux boules {{country}}')}`
        : `🌍 ${t('smart.otherRejected', 'Voir les boules rejetées des autres pays')}`);
    }
    if (toolbar.parentNode !== root || root.lastElementChild !== toolbar) {
      root.appendChild(toolbar);
    }
  }

  function ensureScheduleToolbar() {
    const body = document.getElementById('scheduleBody');
    if (!body || body.querySelector('[data-smart-country-toolbar="schedule"]')) return;
    const country = profileCountry();
    if (!country || country === 'Tous') return;

    const toolbar = document.createElement('div');
    toolbar.className = 'cid-smart-toolbar';
    toolbar.dataset.smartCountryToolbar = 'schedule';
    toolbar.innerHTML = `<div class="cid-smart-toolbar-copy"><strong>${ti('smart.customSchedule', { country }, 'Horaires personnalisés : {{country}}')}</strong><span>${t('smart.existingSchedules', 'Les horaires existants restent inchangés et couvrent tous les programmes.')}</span></div>`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cid-smart-other-button';
    button.textContent = `🌍 ${t('smart.otherSchedules', 'Voir les horaires des autres pays')}`;
    button.addEventListener('click', () => {
      toolbar.querySelector('span').textContent = t('smart.globalView', 'Vue globale activée pour tous les pays.');
    });
    toolbar.appendChild(button);
    body.prepend(toolbar);
  }

  function refreshAdapters() {
    syncPendingCountry();
    ensureSignupCountryField();
    ensureProfileCountryField();
    applyMatrixCountry();
    ensureMatrixOtherCountriesButton();

    const root = rejectedRootElement();
    if (root) {
      if (root !== rejectedRoot) {
        rejectedRoot = root;
        rejectedGlobalOverride = false;
      }
      ensureRejectedToolbar(root);
      filterRejectedGroups(root);
    } else {
      rejectedRoot = null;
      rejectedGlobalOverride = false;
    }
    ensureScheduleToolbar();
  }

  function init() {
    window.__cidUserCountry = profileCountry();
    window.cidSmartCountry = {
      get: profileCountry,
      set: (country) => saveCountry(country, 'api'),
      normalize: countryFromLabel,
      // Synchronous pass for a route that has just mounted its content, so
      // the country filter and its toolbar land in the same frame.
      refresh: refreshAdapters,
      // Matrice level two was just rebuilt: mount its toolbar in the same
      // frame instead of 70 ms later (the button used to pop in and push
      // the country list).
      refreshMatrixToolbar: () => {
        ensureMatrixOtherCountriesButton();
        restoreMatrixAnchor();
      }
    };

    document.addEventListener('change', event => {
      if (event.target?.id === 'fvCountry') saveCountry(event.target.value, 'first-visit');
    });
    document.addEventListener('click', event => {
      if (event.target?.id === 'fvSave') setTimeout(captureFirstVisitCountry, 0);
      const matrixButton = event.target.closest?.('#countryButtons .country-filter-btn');
      if (matrixButton && !applyingMatrix) {
        matrixManualOverride = true;
        const selected = countryFromLabel(matrixButton.dataset.country);
        if (selected !== 'Tous') saveCountry(selected, 'matrix-selector');
      }
    }, true);
    document.addEventListener('submit', event => {
      if (event.target?.id !== 'signupForm') return;
      const selected = document.getElementById('cid-smart-signup-country')?.value;
      if (selected) write(PENDING_KEY, { country: selected, updatedAt: new Date().toISOString() });
    }, true);
    window.addEventListener('cid:auth-sync', () => {
      syncPendingCountry();
      ensureProfileCountryField();
    });
    window.addEventListener('cid:country-change', () => {
      matrixAutoApplied = '';
      matrixManualOverride = false;
      rejectedGlobalOverride = false;
      refreshAdapters();
    });
    window.addEventListener('cid:language-change', refreshAdapters);
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY && event.key !== 'firstVisitCountry') return;
      matrixAutoApplied = '';
      matrixManualOverride = false;
      rejectedGlobalOverride = false;
      refreshAdapters();
    });

    const observer = new MutationObserver(() => {
      clearTimeout(observer.timer);
      observer.timer = setTimeout(refreshAdapters, 70);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    refreshAdapters();
    setInterval(refreshAdapters, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
