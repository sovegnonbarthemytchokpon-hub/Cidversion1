// Bump this whenever the application shell or calculation modules change.
// The old cache-first policy could keep a stale Tableaux renderer alive after
// a deployment, making corrected NAP values appear unchanged.
// Keep in sync with CURRENT_SW_CACHE in /src/shared/cache-lifecycle.js.
const CACHE_NAME = 'cidmap-cache-v43-unified';
const LEGACY_CACHE_PREFIX = 'cidgroup-cache-';
const NETWORK_TIMEOUT_MS = 1200;
// Application shell: single stylesheet, shell images and every entry script.
// ES-module dependencies are added to the same cache on first use.
const URLS_TO_CACHE = [...new Set([
  '/',
  '/index.html',
  '/pwa.htm',
  '/manifest.json',
  '/src/styles/app.css?v=unified-v1',
  '/src/styles/auth-frame.css?v=unified-v1',
  '/src/auth/auth.html',
  '/src/shared/images/squirrel-red-mask.png',
  '/src/shared/images/squirrel-croix-192.png',
  '/src/shared/images/squirrel-croix-512.png',
  '/src/shared/images/croix-canonical.png',
  '/src/shared/images/redCross-610x601.png',
  '/src/shared/images/app-icon-192.png',
  '/src/shared/images/app-icon-512.png',
  '/sfx/like-confirmation.wav',
  '/sfx/unlock-success.wav',
  '/src/shared/cache-lifecycle.js?cache-lifecycle-v43',
  '/src/shared/translation.js?language-session-v4',
  '/src/shared/persistent-cache.js?persistent-cache-v40',
  '/src/shared/component-runtime.js?component-runtime-v41-persistent-paint',
  '/src/shared/international-phone.js?dial-codes-v2-iso-profile',
  '/src/shared/scroll-stability.js?scroll-stability-v2',
  '/src/shared/like-sound.js?like-sound-v1',
  '/src/croix/cross-responsive.js',
  '/src/croix/cross-date-fit.js',
  '/src/croix/draggableCross.js',
  '/src/matrice/displayResults.js',
  '/src/services/site-config.js?anticipation-v2',
  '/src/services/public-social-links.js',
  '/src/services/public-offers.js?offers-dedicated-v2',
  '/src/services/promo-banners.js',
  '/src/services/resultat-aide.js?result-rectangle-v26-i18n',
  '/src/services/history-access.js?history-v4-cache-stable',
  '/src/shared/currency-mode.js',
  '/src/shared/content-control.js',
  '/src/shared/daily-illustrations.js?anticipation-v3-cross-theme',
  '/src/shared/splash-squirrel.js?squirrel-v4',
  '/src/croix/downloadCross.js',
  '/src/shared/security.js',
  '/src/auth/user-stats.js',
  '/src/auth/supabase-config.js',
  '/src/shared/pwa-register.js',
  '/src/services/supabaseClient.js',
  '/src/services/social-repository.js',
  '/src/services/feature-access.js?feature-access-offline-v1',
  '/src/services/access-actions.js',
  '/src/services/early-access-ui.js?anticipation-v2',
  '/src/shared/unlock-feedback.js',
  '/src/auth/message-repository.js',
  '/src/auth/admin-architecture.js',
  '/src/auth/admin-config.js',
  '/src/auth/admin-dashboard.js?v=functions-dashboard-v1',
  '/src/auth/auth.js',
  '/src/services/paystack-payment.js',
  '/src/services/paystack-return.js',
  '/src/auth/account-service.js?auth-flow-v4',
  '/src/notifications/notification-repository.js',
  '/src/notifications/notification-center.js',
  '/src/auth/header-sync.js',
  '/src/auth/referral-system.js',
  '/src/shared/balance-panel.js',
  '/src/auth/profile-native.js?account-route-v6-share-i18n',
  '/src/shared/social-auth-gate.js',
  '/src/shared/header-polish.js',
  '/src/croix/redCrossService.js?cross-geometry-scale-v2-official',
  '/src/shared/i18n.js',
  '/src/shared/app-controllers.js?navigation-v5-scroll-fix',
  '/src/shared/schedule.js',
  '/src/croix/redCross.js',
  '/src/shared/render-readiness.js?nav-shell-v23',
  '/src/shared/route-persistence.js?route-persistence-v3-result-route',
  '/src/shared/view-transition.js',
  '/src/shared/dedicated-view-shell.js',
  '/src/shared/categories-view.js?navigation-v9-date-binding',
  '/src/shared/anticipation-view.js?anticipation-v9-unified',
  '/src/shared/croix-section.js?history-date-focus-v4-proportional-cross',
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
  '/src/croix/red-cross-stability.js',
  '/src/shared/first-paint-shell.js',
  '/src/matrice/matrice-calculation.js?date-binding-v1',
  '/src/services/dechiffrement-api.js?calculator-v5-timeout-plus',
  '/src/calculatrice/calculatrice.js?calculator-v12-ranked-group-limits'
])];

async function fetchWithTimeout(request, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function purgeOldCaches(keep = CACHE_NAME) {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => (
        (name.startsWith('cidmap-cache-')
          || name.startsWith(LEGACY_CACHE_PREFIX)
          || name.startsWith('lotto-cache-'))
        && name !== keep
      ))
      .map((name) => caches.delete(name))
  );
}

// 1. Événement 'install'
self.addEventListener('install', event => {
  console.log('[Service Worker] Installation en cours...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Mise en cache des ressources :', URLS_TO_CACHE);
        /*
         * One optional asset must not abort the whole worker install. Cache
         * every successful response independently, then activate the new
         * shell as one coherent version.
         */
        return Promise.allSettled(
          URLS_TO_CACHE.map((url) => cache.add(url).catch(() => null))
        );
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// 2. Événement 'activate'
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activation en cours...');
  event.waitUntil(
    purgeOldCaches().then(() => {
      // Claim clients so the SW starts controlling uncontrolled clients asap
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CIDMAP_PURGE_OLD_CACHES') return;
  const keep = String(event.data.keep || CACHE_NAME);
  event.waitUntil(purgeOldCaches(keep));
});

// 3. Événement 'fetch' (réseau prioritaire pour les fichiers du projet)
self.addEventListener('fetch', event => {
  // Only handle GET requests (avoid interfering with non-idempotent requests)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache API or third-party requests. Social data, authentication and
  // Supabase responses must always use their own freshness and auth rules.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // For dynamic programme assets prefer network-first with cache fallback to ensure freshness:
  const networkFirstTargets = [
    '/src/shared/images/croix-canonical.png',
    '/src/shared/images/redCross-610x601.png',
    '/croix-canonical-MONDAY-'
  ];

  const isNetworkFirst = networkFirstTargets.some(t => {
    // allow prefix matching for Monday canonical entries
    if (t.endsWith('-')) return url.pathname.startsWith(t);
    return url.pathname === t;
  });

  // HTML is the deployment/version boundary. JavaScript and CSS use a
  // stale-while-revalidate response so an installed PWA remains fast while
  // the next navigation receives the refreshed asset.
  const isApplicationAsset = url.origin === self.location.origin && (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  );
  const isHtmlShell = url.origin === self.location.origin
    && (url.pathname === '/' || url.pathname.endsWith('.html'));

  if (isNetworkFirst || isApplicationAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        const refresh = fetchWithTimeout(event.request, { cache: 'no-store' })
          .then((netResp) => {
            if (netResp && netResp.ok) {
              cache.put(event.request, netResp.clone()).catch(() => {});
            }
            return netResp;
          });

        /*
         * HTML is the version boundary: serve the network copy first so a
         * newly deployed cache-lifecycle script can run immediately. JS/CSS
         * keep stale-while-revalidate for fast offline-capable navigation.
         */
        if (cached && isApplicationAsset && !isNetworkFirst && !isHtmlShell) {
          event.waitUntil(refresh.catch(() => {}));
          return cached;
        }

        try {
          const netResp = await refresh;
          if (netResp) return netResp;
          if (cached) return cached;
          return netResp;
        } catch (err) {
          // network failed -> return cache if available
          const cached = await cache.match(event.request);
          if (cached) return cached;
          // finally fallback to index.html
          const currentCache = await caches.open(CACHE_NAME);
          return currentCache.match('/index.html');
        }
      })()
    );
    return;
  }

  // Default cache-first behavior for other static assets to preserve offline UX
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request).then(response => {
      if (response) {
        return response;
      }
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        const cloned = networkResponse.clone();
        try { cache.put(event.request, cloned); } catch (e) { /* ignore put failures */ }
        return networkResponse;
      }).catch(() => {
        return cache.match('/index.html');
      });
    }))
  );
});
