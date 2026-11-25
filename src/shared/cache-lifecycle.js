/*
 * Cidmap cache lifecycle.
 *
 * Preserve the active offline shell while workers migrate caches. Static
 * styles and interface assets are warmed asynchronously; dynamic publication
 * data remains owned by the application repositories/backend.
 */
(() => {
  'use strict';

  const APP_VERSION = 'v41-mobile-scroll-cache';
  const VERSION_KEY = 'cidmap:app-version';
  // Must equal CACHE_NAME in /service-worker.js (cidmap-cache-v53-publication-card).
  const CURRENT_SW_CACHE = 'cidmap-cache-v53-publication-card';

  const OLD_LOCAL_STORAGE = [
    /^cidmap:/,
    /^cidmap:persistent-cache:/,
    /^cidmap:component-cache:/,
    /^cidmap:history-payload:/,
    /^cidgroup\.feed-hydration\./,
    /^cidgroup\.cross\.official/,
    /^(?:redCrossPositions|canonicalRedCross|lockDisplayedCross|crossServerPayload|lottoState)/,
    /^cidmap:(?:legacy|old|cache|component|history)/
  ];
  const OLD_SESSION_STORAGE = [
    /^cidmap:/,
    /^cidgroup:(?:cache|feed|cross|matrix|tableaux)/
  ];
  const CURRENT_LOCAL_STORAGE = [
    /^cidmap:persistent-cache:v40:/,
    /^cidmap:component-cache:v40:/,
    /^cidmap:history-payload:v40:/,
    /^cidgroup\.feed-hydration\.v40$/,
    /^cidgroup\.cross\.official.*v40/
  ];
  const OLD_DOM_MARKERS = [
    '[data-cid-cache-version]:not([data-cid-cache-version="v40"])',
    '[data-cid-legacy-component]',
    '.cid-legacy-component',
    '.cid-old-component'
  ].join(', ');

  // These are static shell resources only. Do not add API/database endpoints:
  // account and publication data must continue through their existing access
  // checks and local-first repositories.
  const STATIC_ASSETS = [
    '/src/styles/app.css?v=unified-v5-native-scroll',
    '/src/styles/auth-frame.css?v=unified-v1',
    '/src/shared/images/squirrel-red-mask.png',
    '/src/shared/images/squirrel-croix-192.png',
    '/src/shared/images/squirrel-croix-512.png',
    '/src/shared/images/croix-canonical.png',
    '/src/shared/images/redCross-610x601.png',
    '/src/shared/images/app-icon-192.png',
    '/src/shared/images/app-icon-512.png',
    '/src/shared/fonts/archivo-black-latin.woff2',
    '/src/shared/fonts/archivo-black-latin-ext.woff2',
    '/src/shared/fonts/audiowide-latin.woff2',
    '/src/shared/fonts/audiowide-latin-ext.woff2',
    '/src/shared/fonts/noto-sans-latin.woff2',
    '/src/shared/fonts/noto-sans-latin-ext.woff2'
  ];

  function matchesAny(value, patterns) {
    return patterns.some((pattern) => pattern.test(String(value || '')));
  }

  function purgeStorage(storage, patterns, preserve = []) {
    if (!storage) return 0;
    let removed = 0;
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        const keep = typeof preserve === 'function' ? preserve(key) : preserve.includes(key);
        if (!key || keep || !matchesAny(key, patterns)) continue;
        storage.removeItem(key);
        removed += 1;
      }
    } catch (_) {
      // Safari private mode can throw while iterating or removing storage.
    }
    return removed;
  }

  function purgeOldStorage() {
    const preserveCurrent = (storageKey) => (
      storageKey === VERSION_KEY || matchesAny(storageKey, CURRENT_LOCAL_STORAGE)
    );
    purgeStorage(window.localStorage, OLD_LOCAL_STORAGE, preserveCurrent);
    purgeStorage(window.sessionStorage, OLD_SESSION_STORAGE);
  }

  async function purgeBrowserCaches() {
    if (!('caches' in window)) return [];
    try {
      const names = await caches.keys();
      return names.filter((name) => name === CURRENT_SW_CACHE);
    } catch (_) {
      return [];
    }
  }

  async function warmStaticAssets() {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(CURRENT_SW_CACHE);
      await Promise.all(STATIC_ASSETS.map(async (path) => {
        const url = new URL(path, location.origin).href;
        if (await cache.match(url, { ignoreSearch: false })) return;
        try {
          const response = await fetch(url, { credentials: 'same-origin' });
          if (response.ok && response.type !== 'opaque') {
            await cache.put(url, response.clone());
          }
        } catch (_) {
          // Offline/slow fetch is non-fatal; the service worker retains old assets.
        }
      }));
    } catch (_) {
      // Cache Storage may be disabled or unavailable (e.g. private browsing).
    }
  }

  async function refreshServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) => {
          const url = registration.active?.scriptURL || registration.waiting?.scriptURL
            || registration.installing?.scriptURL || '';
          return new URL(url || '/service-worker.js', location.origin).pathname === '/service-worker.js';
        })
        .map(async (registration) => {
          try { await registration.update(); } catch (_) {}
        }));
    } catch (_) {}
  }

  function purgeLegacyDom() {
    if (document.querySelectorAll) {
      document.querySelectorAll(OLD_DOM_MARKERS).forEach((node) => node.remove());
    }
  }

  function dispatchLifecycleEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent('cid:cache-lifecycle', {
        detail: { version: APP_VERSION, changed: Boolean(detail?.changed), purged: true }
      }));
    } catch (_) {}
  }

  function start() {
    let previousVersion = '';
    try { previousVersion = localStorage.getItem(VERSION_KEY) || ''; } catch (_) {}
    const changed = previousVersion !== APP_VERSION;
    if (changed) {
      try { localStorage.setItem(VERSION_KEY, APP_VERSION); } catch (_) {}
    }
    purgeOldStorage();

    // Never block first paint on cache maintenance or worker update checks.
    void purgeBrowserCaches();
    void warmStaticAssets();
    void refreshServiceWorkers();

    const finishDomPurge = () => {
      purgeLegacyDom();
      dispatchLifecycleEvent({ changed });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', finishDomPurge, { once: true });
    } else {
      finishDomPurge();
    }

    window.__cidAppVersion = APP_VERSION;
    window.__cidCacheLifecycle = Object.freeze({
      version: APP_VERSION, changed, purgeBrowserCaches, warmStaticAssets,
      refreshServiceWorkers, purgeLegacyDom
    });
  }

  start();
})();
