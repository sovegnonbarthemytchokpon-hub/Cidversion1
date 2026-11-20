/*
 * Session route memory.
 *
 * The URL remains the shareable/deep-linkable route. sessionStorage is the
 * short-lived context fallback used when a browser reloads the document
 * without preserving the query string. Keeping this state in the session
 * (rather than localStorage) prevents an old route from surprising a visitor
 * who opens the app again later.
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'cidmap:route-state:v1';
  const ROUTES = new Set([
    'accueil',
    'categories',
    'tableaux',
    'notifications',
    'anticipe',
    'wallet',
    'matrice',
    'croix',
    'rejetes',
    'calculator',
    'profil',
    'categories-cidmap-virtuel',
    'categories-resultat-aide',
    'global-statistics',
    'categories-offers',
    'history'
  ]);

  const aliases = Object.freeze({
    home: 'accueil',
    accueil: 'accueil',
    categories: 'categories',
    category: 'categories',
    'categories-cidmap-virtuel': 'categories-cidmap-virtuel',
    'categories-resultat-aide': 'categories-resultat-aide',
    'resultats': 'categories-resultat-aide',
    'resultats-publies': 'categories-resultat-aide',
    statistiques: 'global-statistics',
    'statistiques-globales': 'global-statistics',
    'global-statistics': 'global-statistics',
    'categories-offers': 'categories-offers',
    tableaux: 'tableaux',
    notifications: 'notifications',
    notification: 'notifications',
    matrice: 'matrice',
    matrices: 'matrice',
    croix: 'croix',
    'croix nationale': 'croix',
    'croix-nationale': 'croix',
    rejetes: 'rejetes',
    'boules-rejetees': 'rejetes',
    'numeros-rejetes': 'rejetes',
    calculator: 'calculator',
    calculatrice: 'calculator',
    'dechiffrement-mt': 'calculator',
    profil: 'profil',
    profile: 'profil',
    compte: 'profil',
    account: 'profil',
    early: 'anticipe',
    anticipe: 'anticipe',
    anticipees: 'anticipe',
    portefeuille: 'wallet',
    jetons: 'wallet',
    history: 'history',
    historique: 'history',
    historiques: 'history'
  });

  function normalizeSection(value) {
    const normalized = String(value || '')
      .trim()
      .toLocaleLowerCase('fr-FR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return aliases[normalized] || (ROUTES.has(normalized) ? normalized : null);
  }

  function readStoredRoute() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      const section = normalizeSection(value?.section);
      if (!section) return null;
      return {
        section,
        tab: typeof value.tab === 'string' ? value.tab : null,
        updatedAt: Number(value.updatedAt) || 0,
        source: 'session'
      };
    } catch (_) {
      return null;
    }
  }

  function readUrlRoute() {
    try {
      const params = new URLSearchParams(window.location.search);
      const pathSection = {
        '/accueil': 'accueil',
        '/home': 'accueil',
        '/categories': 'categories',
        '/anticipe': 'anticipe',
        '/anticipation': 'anticipe',
        '/tableaux': 'tableaux',
        '/compte': 'profil',
        '/profil': 'profil',
        '/profile': 'profil',
        '/account': 'profil'
      }[String(window.location.pathname || '').replace(/\/+$/, '')] || '';
      const section = normalizeSection(
        params.get('section')
          || (params.get('account') === '1' ? 'profil' : pathSection)
      );
      if (!section) return null;
      return { section, tab: null, explicit: true, source: 'url' };
    } catch (_) {
      return null;
    }
  }

  function resolveInitialRoute() {
    // An explicit URL is always authoritative: this is what makes shared
    // deep links work even when a previous route exists in this tab.
    const urlRoute = readUrlRoute();
    const storedRoute = readStoredRoute();
    if (urlRoute) {
      return {
        ...urlRoute,
        // Account tabs are in-document state, so preserve the tab when a
        // reload keeps the canonical `section=profil` URL.
        tab: urlRoute.section === 'profil' && storedRoute?.section === 'profil'
          ? storedRoute.tab
          : null
      };
    }
    return storedRoute || {
      section: 'accueil',
      tab: null,
      source: 'default'
    };
  }

  function remember(section, options = {}) {
    const normalizedSection = normalizeSection(section) || 'accueil';
    const current = readStoredRoute();
    const tab = typeof options.tab === 'string'
      ? options.tab
      : (normalizedSection === 'profil' ? current?.tab || null : null);
    const value = {
      section: normalizedSection,
      tab,
      updatedAt: Date.now()
    };
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_) {
      // Disabled storage must not block navigation. URL/history still works.
    }
    window.__cidRouteState = { ...value };
    return value;
  }

  function rememberFromUrl() {
    const route = readUrlRoute();
    if (route) remember(route.section);
  }

  function syncUrl(section, { replace = true, state = {} } = {}) {
    const normalizedSection = normalizeSection(section) || 'accueil';
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', normalizedSection);
      if (normalizedSection !== 'profil') url.searchParams.delete('account');
      const nextState = { ...(window.history.state || {}), ...state, view: normalizedSection };
      if (replace) window.history.replaceState(nextState, '', url.toString());
      else window.history.pushState(nextState, '', url.toString());
    } catch (_) {}
    remember(normalizedSection);
  }

  window.cidRoutePersistence = Object.freeze({
    key: STORAGE_KEY,
    normalizeSection,
    read: readStoredRoute,
    readUrl: readUrlRoute,
    resolveInitialRoute,
    remember,
    rememberFromUrl,
    syncUrl
  });
  window.__cidInitialRoute = resolveInitialRoute();

  // Route owners already use the History API. Observing it here keeps the
  // session memory complete even for a route owned by a specialized module.
  ['pushState', 'replaceState'].forEach((method) => {
    const original = window.history?.[method];
    if (typeof original !== 'function') return;
    window.history[method] = function routeAwareHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.cidRoutePersistence?.rememberFromUrl();
      return result;
    };
  });

  window.addEventListener('popstate', () => {
    window.cidRoutePersistence?.rememberFromUrl();
  });

  window.addEventListener('cid:account-tab', (event) => {
    const tab = event.detail?.tab;
    if (typeof tab !== 'string' || !tab.trim()) return;
    remember('profil', { tab: tab.trim() });
  });
})();
