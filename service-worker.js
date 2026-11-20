// Bump this whenever the application shell or calculation modules change.
// The old cache-first policy could keep a stale Tableaux renderer alive after
// a deployment, making corrected NAP values appear unchanged.
const CACHE_NAME = 'cidmap-cache-v42-tableaux-offline';
const LEGACY_CACHE_PREFIX = 'cidgroup-cache-';
const NETWORK_TIMEOUT_MS = 1200;
const URLS_TO_CACHE = [...new Set([
  '/',
  '/index.html',
  '/pwa.htm',
  '/manifest.json',
  '/service-worker.js',
  '/src/shared/cache-lifecycle.js?cache-lifecycle-v40',
  '/src/shared/pwa-register.js',
  '/src/shared/styles.css',
  '/src/shared/responsive.css',
  '/src/shared/mobile-modern.css',
  '/src/shared/facebook-feed.css',
  '/src/shared/facebook-feed.js?feed-date-archive-v3-proportional-cross',
  '/src/shared/dedicated-view-shell.css?route-scroll-fix-v4-virtual-messenger',
  '/src/shared/view-layer-isolation.css',
  '/src/shared/first-paint-shell.css',
  '/src/shared/native-pages.css?route-scroll-fix-v1',
  '/src/croix/cross-canonical.css?archive-card-geometry-v2',
  '/src/shared/surface-palette.css?nav-shell-v22',
  '/src/shared/code-freeze.css?nav-shell-v27-scroll-fix',
  '/src/shared/component-stability.css?component-stability-v41-persistent-paint',
  '/src/shared/component-runtime.js?component-runtime-v41-persistent-paint',
  '/src/shared/scroll-stability.js?scroll-stability-v2',
  '/src/shared/dedicated-view-shell.js',
  '/src/shared/first-paint-shell.js',
  '/src/shared/croix-section.css?history-date-focus-v1',
  '/src/shared/croix-section.js?history-date-focus-v1',
  '/src/shared/render-readiness.js?nav-shell-v23',
  '/src/shared/affichageSecurise.js',
  '/src/auth/profile-native.js?account-route-v6-share-i18n',
  '/src/shared/route-persistence.js?route-persistence-v3-result-route',
  '/src/shared/categories-view.js?navigation-v9-date-binding',
  '/src/shared/app-controllers.js?navigation-v5-scroll-fix',
  '/src/shared/bootstrap.js?nav-shell-v24-route-fix',
  '/src/croix/redCrossService.js',
  '/src/croix/red-cross-stability.js',
  '/src/croix/croix-controller.js',
  '/src/croix/redCross.js',
  '/src/croix/cross-geometry.css',
  '/src/croix/cross-responsive.js',
  '/src/tableaux/tableaux-view.js?tableaux-contract-v4-offline-snapshot',
  '/src/tableaux/styles/original/main.css',
  '/src/tableaux/styles/original/containers.css',
  '/src/tableaux/styles/original/cross.css',
  '/src/tableaux/styles/original/tables.css',
  '/src/tableaux/styles/original/responsive.css',
  '/src/tableaux/styles/cidgroup-bridge.css?tableaux-clone-v2',
  '/src/tableaux/styles/sections.css',
  '/components/tableaux/ViewUniverselle.js',
  '/components/tableaux/ViewIntuition.js',
  '/components/tableaux/ViewOracle.js',
  '/components/tableaux/ViewLNB.js',
  '/components/tableaux/ViewBalsa.js',
  '/components/tableaux/ViewStandBy.js',
  '/components/tableaux/ViewProgramRunner.js',
  '/src/services/social-repository.js',
  '/src/matrice/matrice-calculation.js',
  '/src/shared/images/squirrel-croix-192.png',
  '/src/shared/images/squirrel-croix-512.png',
  '/src/shared/splash-squirrel.css?squirrel-v4',
  '/src/shared/splash-squirrel.js?squirrel-v4',
  '/src/shared/native-shell.css?nav-shell-v23-squirrel-v4',
  '/src/shared/mobile-modern.css?nav-shell-v23-squirrel-v4',
  '/src/shared/header-polish.css?squirrel-v4',
  '/src/shared/code-freeze.css?nav-shell-v27-scroll-fix'
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
