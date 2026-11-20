/*
 * Cidmap cache lifecycle.
 *
 * The application owns several historical cache formats. A single version
 * boundary prevents an old payload, service-worker cache or session route
 * from being mixed with the current DOM contract.
 *
 * Deliberately preserved:
 * - authentication/session tokens;
 * - language and country preferences;
 * - user-facing settings.
 *
 * Everything that is a paint cache, generated result, old route snapshot or
 * application shell cache is removed when the application version changes.
 */
(() => {
  'use strict';

  const APP_VERSION = 'v40-performance-cache';
  const VERSION_KEY = 'cidmap:app-version';
  // Must equal CACHE_NAME in /service-worker.js, otherwise every boot deletes
  // the live offline cache and all images/scripts are downloaded again.
  const CURRENT_SW_CACHE = 'cidmap-cache-v44-unified';

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
  const APP_CACHE_NAME = /^(?:cidmap-cache-|cidgroup-cache-|lotto-cache-)/i;
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
        const keep = typeof preserve === 'function'
          ? preserve(key)
          : preserve.includes(key);
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
    /*
     * Run on every boot, not only on a version transition. A previous tab or
     * an older worker can finish a late write after the migration marker was
     * stored; preserving only current v40 keys removes that residue too.
     */
    const preserveCurrent = (storageKey) => (
      storageKey === VERSION_KEY
      || matchesAny(storageKey, CURRENT_LOCAL_STORAGE)
    );
    purgeStorage(window.localStorage, OLD_LOCAL_STORAGE, preserveCurrent);
    // Route state is ephemeral and can point to DOM that no longer exists.
    purgeStorage(window.sessionStorage, OLD_SESSION_STORAGE);
  }

  async function purgeBrowserCaches() {
    if (!('caches' in window)) return [];
    try {
      const names = await caches.keys();
      const stale = names.filter((name) => (
        APP_CACHE_NAME.test(name) && name !== CURRENT_SW_CACHE
      ));
      await Promise.all(stale.map((name) => caches.delete(name)));
      return stale;
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
          const url = registration.active?.scriptURL
            || registration.waiting?.scriptURL
            || registration.installing?.scriptURL
            || '';
          return new URL(url || '/service-worker.js', location.origin)
            .pathname === '/service-worker.js';
        })
        .map(async (registration) => {
          try { await registration.update(); } catch (_) {}
          const worker = registration.waiting || registration.active;
          worker?.postMessage?.({
            type: 'CIDMAP_PURGE_OLD_CACHES',
            keep: CURRENT_SW_CACHE,
            version: APP_VERSION
          });
        }));
    } catch (_) {}
  }

  function purgeLegacyDom() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll(OLD_DOM_MARKERS).forEach((node) => node.remove());
  }

  function dispatchLifecycleEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent('cid:cache-lifecycle', {
        detail: {
          version: APP_VERSION,
          changed: Boolean(detail?.changed),
          purged: true
        }
      }));
    } catch (_) {}
  }

  function start() {
    let previousVersion = '';
    try { previousVersion = localStorage.getItem(VERSION_KEY) || ''; } catch (_) {}
    const changed = previousVersion !== APP_VERSION;

    // This part is synchronous and runs before application modules mount.
    if (changed) {
      try { localStorage.setItem(VERSION_KEY, APP_VERSION); } catch (_) {}
    }
    purgeOldStorage();

    /*
     * Cache API and service-worker updates are asynchronous by platform
     * design. They never enter the first-paint critical path.
     */
    void purgeBrowserCaches();
    void refreshServiceWorkers();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        void purgeBrowserCaches();
      }, { once: true });
    }

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
      version: APP_VERSION,
      changed,
      purgeBrowserCaches,
      refreshServiceWorkers,
      purgeLegacyDom
    });
  }

  start();
})();
