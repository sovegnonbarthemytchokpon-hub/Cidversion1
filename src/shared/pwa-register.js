/*
 * Cidmap PWA bootstrap.
 *
 * Register and update the worker away from the first-paint path. A restored
 * cache remains usable while registration/update requests are pending or fail.
 */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (window.__cidPwaRegistrationPromise) return;

  const register = () => {
    if (window.__cidPwaRegistrationPromise) return window.__cidPwaRegistrationPromise;
    window.__cidPwaRegistrationPromise = navigator.serviceWorker
      .register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        // Update checks are best effort; never await them during app startup.
        registration.update().catch(() => {});
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
  // network returns, without reloading or blocking the currently painted app.
  window.addEventListener('online', () => {
    const registrationPromise = window.__cidPwaRegistrationPromise;
    if (!registrationPromise) {
      void register();
      return;
    }
    registrationPromise.then((registration) => registration?.update?.().catch(() => {}));
  });

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
