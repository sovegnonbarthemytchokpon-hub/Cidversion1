/*
 * Cidmap PWA bootstrap.
 *
 * The main entry point owns the service-worker registration so the installed
 * app and the browser version use the same application shell.
 */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  /*
   * This module can be evaluated again after a hot revision or an installed
   * PWA navigation. Keep registration and update checks idempotent, and move
   * them off the visual startup path so a worker update cannot compete with
   * the shell's first layout.
   */
  if (window.__cidPwaRegistrationPromise) return;

  const register = () => {
    if (window.__cidPwaRegistrationPromise) return window.__cidPwaRegistrationPromise;
    window.__cidPwaRegistrationPromise = navigator.serviceWorker
      .register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none'
      })
      .then((registration) => {
        registration.update().catch(() => {});
        if (!window.__cidPwaReadyDispatched) {
          window.__cidPwaReadyDispatched = true;
          window.dispatchEvent(new CustomEvent('cid:pwa-ready', {
            detail: { registration }
          }));
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
    const run = () => register();
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 4000 });
    } else {
      window.setTimeout(run, 1200);
    }
  };

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
