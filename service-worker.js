// Keep in sync with CURRENT_SW_CACHE in /src/shared/cache-lifecycle.js.
const CACHE_NAME = 'cidmap-cache-v46-offline-first';
const LEGACY_CACHE_PREFIX = 'cidgroup-cache-';
const NETWORK_TIMEOUT_MS = 1400;
const APP_CSS = '/src/styles/app.css?v=unified-v2';

// The current shell, styles, fonts, and images are precached. The remaining
// scripts are cached as they are requested and are also warmed here where
// possible. A failed optional request must never prevent worker installation.
const URLS_TO_CACHE = [...new Set([
  '/', '/index.html', '/pwa.htm', '/manifest.json', APP_CSS,
  '/src/shared/fonts/archivo-black-latin.woff2',
  '/src/shared/fonts/archivo-black-latin-ext.woff2',
  '/src/shared/fonts/audiowide-latin.woff2',
  '/src/shared/fonts/audiowide-latin-ext.woff2',
  '/src/shared/fonts/noto-sans-latin.woff2',
  '/src/shared/fonts/noto-sans-latin-ext.woff2',
  '/src/styles/auth-frame.css?v=unified-v1', '/src/auth/auth.html',
  '/src/shared/images/squirrel-red-mask.png',
  '/src/shared/images/squirrel-croix-192.png',
  '/src/shared/images/squirrel-croix-512.png',
  '/src/shared/images/croix-canonical.png',
  '/src/shared/images/redCross-610x601.png',
  '/src/shared/images/app-icon-192.png',
  '/src/shared/images/app-icon-512.png',
  '/sfx/like-confirmation.wav', '/sfx/unlock-success.wav',
  '/src/shared/cache-lifecycle.js?cache-lifecycle-v45',
  '/src/shared/translation.js?language-session-v4',
  '/src/shared/persistent-cache.js?persistent-cache-v40',
  '/src/shared/component-runtime.js?component-runtime-v41-persistent-paint',
  '/src/shared/international-phone.js?dial-codes-v2-iso-profile',
  '/src/shared/scroll-stability.js?scroll-stability-v2',
  '/src/shared/like-sound.js?like-sound-v1',
  '/src/croix/cross-responsive.js', '/src/croix/cross-date-fit.js',
  '/src/croix/draggableCross.js', '/src/matrice/displayResults.js',
  '/src/services/site-config.js?anticipation-v2',
  '/src/services/public-social-links.js',
  '/src/services/public-offers.js?offers-dedicated-v2',
  '/src/services/promo-banners.js',
  '/src/services/resultat-aide.js?result-rectangle-v26-i18n',
  '/src/services/history-access.js?history-v4-cache-stable',
  '/src/shared/currency-mode.js', '/src/shared/content-control.js',
  '/src/shared/daily-illustrations.js?anticipation-v3-cross-theme',
  '/src/shared/splash-squirrel.js?squirrel-v4',
  '/src/croix/downloadCross.js', '/src/shared/security.js',
  '/src/auth/user-stats.js', '/src/auth/supabase-config.js',
  '/src/shared/pwa-register.js', '/src/services/supabaseClient.js',
  '/src/services/social-repository.js',
  '/src/services/feature-access.js?feature-access-offline-v1',
  '/src/services/access-actions.js',
  '/src/services/early-access-ui.js?anticipation-v2',
  '/src/shared/unlock-feedback.js', '/src/auth/message-repository.js',
  '/src/auth/admin-architecture.js', '/src/auth/admin-config.js',
  '/src/auth/admin-dashboard.js?v=functions-dashboard-v1',
  '/src/auth/auth.js', '/src/services/paystack-payment.js',
  '/src/services/paystack-return.js',
  '/src/auth/account-service.js?auth-flow-v4',
  '/src/notifications/notification-repository.js',
  '/src/notifications/notification-center.js', '/src/auth/header-sync.js',
  '/src/auth/referral-system.js', '/src/shared/balance-panel.js',
  '/src/auth/profile-native.js?account-route-v6-share-i18n',
  '/src/shared/social-auth-gate.js', '/src/shared/header-polish.js',
  '/src/croix/redCrossService.js?cross-geometry-scale-v2-official',
  '/src/shared/i18n.js',
  '/src/shared/app-controllers.js?navigation-v5-scroll-fix',
  '/src/shared/schedule.js', '/src/croix/redCross.js',
  '/src/shared/render-readiness.js?nav-shell-v23',
  '/src/shared/route-persistence.js?route-persistence-v3-result-route',
  '/src/shared/view-transition.js', '/src/shared/dedicated-view-shell.js',
  '/src/shared/categories-view.js?navigation-v9-date-binding',
  '/src/shared/anticipation-view.js?anticipation-v9-unified',
  '/src/shared/croix-section.js?history-local-first-v5',
  '/src/shared/publication-history-view.js?publication-history-v8-prefetch',
  '/src/shared/affichageSecurise.js',
  '/src/tableaux/tableaux-view.js?tableaux-unified-v5',
  '/src/croix/image-scanner.js',
  '/src/modules/croix-nationale/CroixNationaleView.js',
  '/src/modules/boules-rejetees/BoulesRejeteesView.js',
  '/src/modules/matrices-plurijetees/MatricesView.js',
  '/src/calculatrice/matrix-text-parser.js',
  '/src/shared/facebook-feed.js?feed-date-archive-v3-proportional-cross',
  '/src/shared/smart-country-filter.js',
  '/src/shared/bootstrap.js?nav-shell-v24-route-fix',
  '/src/shared/isolated-components.js?isolated-components-v1',
  '/src/croix/red-cross-stability.js', '/src/shared/first-paint-shell.js',
  '/src/matrice/matrice-calculation.js?date-binding-v1',
  '/src/services/dechiffrement-api.js?calculator-v5-timeout-plus',
  '/src/calculatrice/calculatrice.js?calculator-v12-ranked-group-limits'
])];

const SHELL_URLS = ['/', '/index.html', APP_CSS];

async function fetchWithTimeout(request, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sameOriginRequest(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isCacheableResponse(response) {
  return Boolean(response && response.ok && response.type !== 'opaque');
}

async function matchAcrossCaches(request, options = {}) {
  const current = await caches.open(CACHE_NAME);
  let response = await current.match(request, options);
  if (response) return response;
  const names = (await caches.keys()).filter((name) => name !== CACHE_NAME);
  for (const name of names) {
    try {
      response = await (await caches.open(name)).match(request, options);
      if (response) return response;
    } catch (_) {}
  }
  return undefined;
}

async function saveResponse(cache, request, response) {
  if (isCacheableResponse(response)) {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
  return response;
}

async function seedFromPreviousCaches(cache, url) {
  const request = new Request(new URL(url, self.location.origin).href);
  let response = await cache.match(request);
  if (response) return response;
  response = await matchAcrossCaches(request);
  // Query-string revisions can change while the pathname stays the same.
  if (!response) response = await matchAcrossCaches(request, { ignoreSearch: true });
  if (response) {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
  return response;
}

async function warmUrl(cache, url) {
  const request = new Request(new URL(url, self.location.origin).href, { cache: 'reload' });
  try {
    const response = await fetchWithTimeout(request);
    if (isCacheableResponse(response)) await saveResponse(cache, request, response);
  } catch (_) {
    // Offline or a slow origin: keep the previous version, if any.
  }
}

async function purgeOldCaches() {
  const names = await caches.keys();
  const shellReady = await Promise.all(SHELL_URLS.map(async (url) => Boolean(
    await seedFromPreviousCaches(await caches.open(CACHE_NAME), url)
  ))).then((values) => values.every(Boolean));
  // Never delete the working offline shell if the new version could not inherit it.
  if (!shellReady) return;
  await Promise.all(names
    .filter((name) => (
      (name.startsWith('cidmap-cache-') || name.startsWith(LEGACY_CACHE_PREFIX)
        || name.startsWith('lotto-cache-')) && name !== CACHE_NAME
    ))
    .map((name) => caches.delete(name)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Copy old offline resources first so a deployment never starts from an
    // empty cache. Network refreshes are bounded and non-fatal.
    await Promise.all(SHELL_URLS.map((url) => seedFromPreviousCaches(cache, url)));
    await Promise.all(URLS_TO_CACHE.map((url) => seedFromPreviousCaches(cache, url)));
    await Promise.all(URLS_TO_CACHE.map((url) => warmUrl(cache, url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await purgeOldCaches();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CIDMAP_PURGE_OLD_CACHES') {
    event.waitUntil(purgeOldCaches());
  }
});

function offlineDocument() {
  return new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cidmap hors connexion</title><body><main><h1>Cidmap</h1><p>Connexion indisponible. Réessayez lorsque le réseau sera rétabli.</p></main></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function offlineAsset(request) {
  const destination = request.destination;
  if (destination === 'style' || /\.css$/i.test(new URL(request.url).pathname)) {
    return new Response('/* Cidmap: feuille de style hors connexion indisponible. */', {
      status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' }
    });
  }
  if (destination === 'script' || /\.(?:mjs|js)$/i.test(new URL(request.url).pathname)) {
    return new Response('/* Cidmap: script hors connexion indisponible. */', {
      status: 200, headers: { 'Content-Type': 'text/javascript; charset=utf-8' }
    });
  }
  // A transparent image is preferable to a broken-image icon/frame.
  if (destination === 'image' || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(new URL(request.url).pathname)) {
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0)),
      { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }
    );
  }
  return new Response('Ressource Cidmap indisponible hors connexion.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !sameOriginRequest(request)) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isDocument = request.mode === 'navigate'
    || request.destination === 'document'
    || url.pathname === '/' || /\.(?:html?|htm)$/i.test(url.pathname);
  const isStaticAsset = isDocument || ['style', 'script', 'image', 'font'].includes(request.destination)
    || /\.(?:css|mjs|js|avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf)$/i.test(url.pathname);
  // Application data and other dynamic requests are left to the page/backend;
  // only the shell and static front-end assets belong in this cache.
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await matchAcrossCaches(request)
      || await matchAcrossCaches(request, { ignoreSearch: true });

    const refresh = fetchWithTimeout(request, { cache: 'no-store' })
      .then((response) => saveResponse(cache, request, response));

    if (cached) {
      // Immediate cache/localStorage-first paint; network refresh never gates it.
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }

    try {
      const response = await refresh;
      if (response) return response;
    } catch (_) {}

    if (isDocument) {
      const fallback = await matchAcrossCaches(new Request(new URL('/index.html', self.location.origin)));
      return fallback || offlineDocument();
    }
    return offlineAsset(request);
  })());
});
