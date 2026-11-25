/*
 * Cidmap PWA bootstrap and update flow.
 *
 * Register and update the worker away from the first-paint path. A restored
 * cache remains usable while registration/update requests are pending or fail.
 *
 * Updates (installed app included):
 *   1. every deployment bumps SW_VERSION in /service-worker.js;
 *   2. the browser fetches the worker without HTTP cache (updateViaCache:
 *      'none' + Cache-Control: no-cache) at startup, when the app returns to
 *      the foreground (at most every 15 min), on reconnection and hourly;
 *   3. the new worker installs, skips waiting, purges older caches and
 *      claims the open windows;
 *   4. the page reloads once, cleanly, onto the new release — immediately if
 *      it is in the background, otherwise at the next return to the app or
 *      after a short idle delay so a tap in progress is never interrupted.
 *      The visitor is never asked to confirm anything.
 *
 * Offline sections: every same-origin file a visited section used (scripts,
 * styles, fonts, images, locales) is handed to the worker, which keeps it in
 * the release cache. Sections already opened therefore reopen offline with
 * their code and stylesheet, without downloading the CSS again.
 */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (window.__cidPwaRegistrationPromise) return;

  const UPDATE_CHECK_MIN_INTERVAL_MS = 15 * 60 * 1000;
  const HOURLY_MS = 60 * 60 * 1000;
  const RELOAD_GUARD_KEY = 'cidmap:sw-reloaded-at';
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastUpdateCheck = 0;
  let reloadPending = false;
  let lastInteraction = Date.now();

  ['pointerdown', 'keydown', 'touchstart'].forEach((type) => {
    window.addEventListener(type, () => { lastInteraction = Date.now(); }, { passive: true, capture: true });
  });

  function checkForUpdate(registration, force = false) {
    if (!registration?.update) return;
    if (!force && Date.now() - lastUpdateCheck < UPDATE_CHECK_MIN_INTERVAL_MS) return;
    lastUpdateCheck = Date.now();
    registration.update().catch(() => {});
  }

  function activateWaiting(registration) {
    // A worker built before skipWaiting() was automatic may be waiting.
    registration?.waiting?.postMessage?.({ type: 'CIDMAP_SKIP_WAITING' });
  }

  function reloadOnce() {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
      // Never loop: at most one automatic reload every 30 s.
      if (Date.now() - last < 30 * 1000) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch (_) {}
    window.location.reload();
  }

  function scheduleReload() {
    if (reloadPending) return;
    reloadPending = true;
    window.dispatchEvent(new CustomEvent('cid:pwa-updated'));
    const attempt = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastInteraction > 2500) {
        reloadOnce();
        return true;
      }
      return false;
    };
    if (attempt()) return;
    const timer = window.setInterval(() => {
      if (attempt()) window.clearInterval(timer);
    }, 1500);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reloadOnce();
    }, { once: true });
  }

  const warmedUrls = new Set();
  let warmTimer = 0;

  function visitedResourceUrls() {
    const urls = [];
    const push = (value) => {
      try {
        const url = new URL(value, location.href);
        if (url.origin !== location.origin || url.searchParams.has('retry')) return;
        const href = url.pathname + url.search;
        if (warmedUrls.has(href)) return;
        warmedUrls.add(href);
        urls.push(href);
      } catch (_) {}
    };
    try {
      performance.getEntriesByType('resource').forEach((entry) => push(entry.name));
    } catch (_) {}
    document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preload"][href], img[src]')
      .forEach((node) => push(node.getAttribute('src') || node.getAttribute('href')));
    return urls;
  }

  function warmVisitedSections() {
    warmTimer = 0;
    const worker = navigator.serviceWorker.controller;
    if (!worker || !navigator.onLine) return;
    const urls = visitedResourceUrls();
    if (urls.length) worker.postMessage({ type: 'CIDMAP_WARM_URLS', urls });
  }

  function scheduleWarmVisitedSections(delay = 1800) {
    if (warmTimer) return;
    warmTimer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(warmVisitedSections, { timeout: 3000 });
      } else {
        warmVisitedSections();
      }
    }, delay);
  }

  // Section changes toggle body classes (accueil-active, tableaux-active…).
  const observeSections = () => {
    if (!document.body || typeof MutationObserver !== 'function') return;
    new MutationObserver(() => scheduleWarmVisitedSections())
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.body) observeSections();
  else document.addEventListener('DOMContentLoaded', observeSections, { once: true });
  window.addEventListener('popstate', () => scheduleWarmVisitedSections());
  window.addEventListener('online', () => scheduleWarmVisitedSections(800));

  // First install: the worker claims the page without a reload. Afterwards
  // a controller change means a new release is in charge.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) scheduleReload();
    else scheduleWarmVisitedSections(600);
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'CIDMAP_SW_ACTIVATED' && hadController) scheduleReload();
  });

  const register = () => {
    if (window.__cidPwaRegistrationPromise) return window.__cidPwaRegistrationPromise;
    window.__cidPwaRegistrationPromise = navigator.serviceWorker
      .register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        // Update checks are best effort; never await them during app startup.
        checkForUpdate(registration, true);
        activateWaiting(registration);
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') activateWaiting(registration);
          });
        });
        window.setInterval(() => checkForUpdate(registration, true), HOURLY_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate(registration);
        });
        scheduleWarmVisitedSections(2500);
        if (!window.__cidPwaReadyDispatched) {
          window.__cidPwaReadyDispatched = true;
          window.dispatchEvent(new CustomEvent('cid:pwa-ready', { detail: { registration } }));
        }
        return registration;
      })
      .catch((error) => {
        window.__cidPwaRegistrationPromise = null;
        console.warn('Service Worker Cidmap indisponible', error);
        return null;
      });
    return window.__cidPwaRegistrationPromise;
  };

  const schedule = () => {
    const run = () => { void register(); };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 4000 });
    } else {
      window.setTimeout(run, 1200);
    }
  };

  // Retry a failed initial registration and check for deployments when the
  // network returns, without blocking the currently painted app.
  window.addEventListener('online', () => {
    const registrationPromise = window.__cidPwaRegistrationPromise;
    if (!registrationPromise) {
      void register();
      return;
    }
    registrationPromise.then((registration) => checkForUpdate(registration, true));
  });

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
