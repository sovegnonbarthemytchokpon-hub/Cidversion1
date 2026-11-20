/*
 * Cidmap cache lifecycle.
 *
 * Keep the previous Service Worker cache until the new worker has copied the
 * offline shell and activated successfully. Deleting it during page startup
 * can leave a newly deployed app without its HTML, CSS, or images when offline.
 */
(() => {
  'use strict';

  const APP_VERSION = 'v40-performance-cache';
  const VERSION_KEY = 'cidmap:app-version';
  // Must equal CACHE_NAME in /service-worker.js.
  const CURRENT_SW_CACHE = 'cidmap-cache-v47-offline-modules';

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

  // Cache migration and cleanup are owned by the Service Worker. In particular,
  // do not delete the previous shell while a new worker is still installing.
  async function purgeBrowserCaches() {
    if (!('caches' in window)) return [];
    try {
      const names = await caches.keys();
      return names.filter((name) => name === CURRENT_SW_CACHE);
    } catch (_) {
      return [];
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

    // Storage/cache maintenance and update checks are deliberately off the
    // first-paint path; localStorage-backed content can render immediately.
    void purgeBrowserCaches();
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
      version: APP_VERSION, changed, purgeBrowserCaches, refreshServiceWorkers, purgeLegacyDom
    });
  }

  start();
})();
