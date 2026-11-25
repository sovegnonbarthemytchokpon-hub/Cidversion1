/*
 * Cidmap stylesheet guard.
 *
 * Runs right after the application stylesheet (a classic script placed after
 * a render-blocking <link> only executes once that stylesheet has loaded or
 * failed). If the rules are missing — network error, truncated download or
 * an empty offline stub — the page gets a minimal safety layout (no giant
 * icons, no stretched buttons) and the stylesheet is requested again; the
 * service worker answers from its cache when offline.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const MARKER = '--main-bg-color';
  const MAX_RETRIES = 2;
  let retries = 0;

  function stylesLoaded() {
    try {
      return Boolean(getComputedStyle(root).getPropertyValue(MARKER).trim());
    } catch (_) {
      return true;
    }
  }

  function retry() {
    const current = document.getElementById('cidAppCss');
    if (!current || retries >= MAX_RETRIES) return;
    retries += 1;
    const next = document.createElement('link');
    next.rel = 'stylesheet';
    next.id = 'cidAppCss';
    const url = new URL(current.getAttribute('href'), location.href);
    url.searchParams.set('retry', String(Date.now()));
    next.href = url.pathname + url.search;
    next.addEventListener('load', () => {
      if (stylesLoaded()) {
        current.remove();
        root.classList.remove('cid-css-missing');
      } else {
        window.setTimeout(retry, 1500);
      }
    });
    next.addEventListener('error', () => { window.setTimeout(retry, 1500); });
    current.id = '';
    current.after(next);
  }

  if (stylesLoaded()) return;
  root.classList.add('cid-css-missing');
  retry();
  // Back online: one more attempt if the safety layout is still active.
  window.addEventListener('online', () => {
    if (!root.classList.contains('cid-css-missing')) return;
    retries = Math.min(retries, MAX_RETRIES - 1);
    retry();
  });
})();
