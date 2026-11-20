/*
 * Single non-blocking application bootstrap.
 *
 * Every runtime module is registered once by index.html. This file owns the
 * initial auth route, background refreshes and the final render-readiness
 * release. Only the small session decision can hold the startup gate; the
 * rest of the application remains non-blocking after the browser's native
 * load boundary has completed and the shell geometry has been checked.
 */

(() => {
  'use strict';

  const initialRoute = window.cidRoutePersistence?.resolveInitialRoute?.()
    || window.__cidInitialRoute
    || { section: 'accueil', tab: null, source: 'default' };
  const requestedSection = initialRoute.section || 'accueil';
  const initialCroixDate = new URLSearchParams(window.location.search).get('date') || '';
  const requestedAccount = requestedSection === 'profil'
    || new URLSearchParams(window.location.search).get('account') === '1'
    || window.__cidAccountRouteRequested === true;

  function readSessionHint() {
    const hint = window.__cidInitialSessionHint;
    if (!hint) return null;
    return {
      session: hint,
      user: hint.user || null
    };
  }

  async function resolveInitialSession({ timeoutMs = 450 } = {}) {
    const hint = readSessionHint();
    try {
      const bridge = await Promise.race([
        Promise.resolve(window.cidSupabaseReady),
        new Promise((resolve) => window.setTimeout(() => resolve(null), timeoutMs))
      ]);
      const result = await Promise.race([
        bridge?.auth?.getSession?.(),
        new Promise((resolve) => window.setTimeout(() => resolve(null), timeoutMs))
      ]);
      const session = result?.data?.session || null;
      if (session?.user?.id) return { session, user: session.user };
      return hint?.user?.id ? hint : { session: null, user: null };
    } catch (error) {
      console.warn('Restauration de session initiale indisponible', error);
      return hint?.user?.id ? hint : { session: null, user: null };
    }
  }

  function routeImmediately(authState) {
    try {
      // Do not inherit Safari's saved page position on a cold start. The
      // application owns scrolling through its dedicated surfaces.
      try { window.history.scrollRestoration = 'manual'; } catch (_) {}
      window.scrollTo(0, 0);
      document.querySelectorAll(
        '#results, #categoriesView, #tableauxViewContainer, ' +
        '#profileViewContainer, #croixViewContainer, #matrixCalculatorPanel, ' +
        '#anticipationViewContainer, #resultatAideViewContainer, ' +
        '#globalStatisticsViewContainer'
      ).forEach((surface) => {
        surface.scrollTop = 0;
        surface.scrollLeft = 0;
      });
      // Authentication only controls what Account can render. It must not
      // override a deep link or the route remembered for this tab.
      if (requestedAccount && typeof window.showProfileView === 'function') {
        window.__cidInitialSessionUser = authState.user;
        window.showProfileView({ updateHistory: false });
        if (initialRoute.tab) window.cidSetAccountTab?.(initialRoute.tab);
        return;
      }
      if (requestedSection === 'notifications'
        && typeof window.cidNotifications?.open === 'function') {
        window.cidNotifications.open({ updateHistory: false });
        return;
      }
      if (requestedSection === 'anticipe'
        && typeof window.showAnticipationView === 'function') {
        Promise.resolve(window.showAnticipationView({ updateHistory: false }))
          .catch(() => {});
        return;
      }
      if (requestedSection === 'tableaux'
        && typeof window.showTableauxView === 'function') {
        window.showTableauxView({ updateHistory: false }).catch(() => {});
        return;
      }
      if (requestedSection === 'categories'
        && typeof window.showCategoriesView === 'function') {
        window.showCategoriesView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'categories-resultat-aide'
        && typeof window.showResultatAideView === 'function') {
        window.showResultatAideView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'global-statistics'
        && typeof window.showGlobalStatisticsView === 'function') {
        window.showGlobalStatisticsView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'categories-offers'
        && typeof window.showOffersView === 'function') {
        window.showOffersView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'categories-cidmap-virtuel'
        && typeof window.showPublicVirtualView === 'function') {
        window.showPublicVirtualView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'history'
        && typeof window.showHistoryView === 'function') {
        window.showHistoryView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'matrice'
        && typeof window.activateMatriceView === 'function') {
        window.activateMatriceView({
          updateHistory: false,
          programmeDate: initialCroixDate
        });
        return;
      }
      if (requestedSection === 'calculator'
        && typeof window.showCalculatorView === 'function') {
        window.showCalculatorView({ updateHistory: false });
        return;
      }
      if (requestedSection === 'wallet'
        && typeof window.cidShowBalancePanel === 'function') {
        window.cidShowBalancePanel({ updateHistory: false });
        return;
      }
      if (requestedSection === 'croix'
        && typeof window.showCroixView === 'function') {
        Promise.resolve(window.showCroixView({
          updateHistory: false,
          date: initialCroixDate
        }))
          .catch(() => {});
        return;
      }
      if (requestedSection === 'rejetes'
        && typeof window.showRejectedView === 'function') {
        Promise.resolve(window.showRejectedView({
          updateHistory: false,
          date: initialCroixDate
        }))
          .catch(() => {});
        return;
      }
      // The translation layer may already have changed "Accueil" to
      // "Home" before the initial route runs. Prefer the stable id and keep
      // the text lookup only as a legacy fallback.
      const accueilButton = document.getElementById('categoryAccueilButton')
        || Array.from(document.querySelectorAll('.category-item')).find((button) => {
          const label = button.textContent.trim().toLocaleLowerCase();
          return label === 'accueil' || label === 'home';
        });
      if (accueilButton && !accueilButton.classList.contains('active')) {
        accueilButton.click();
      }
    } catch (error) {
      console.warn('Initial route unavailable; keeping the stable shell.', error);
    }
  }

  function registerHomeContentReady() {
    if (typeof window.__cidRegisterContentReady !== 'function') return;

    /*
     * The home feed and Matrice own independent data lifecycles. Waiting for
     * the network before revealing the shell made one slow request cover
     * already-painted cached cards with a white frame. The DOM shell is ready
     * synchronously; each component now paints its cache (when available) and
     * revalidates without holding its siblings or the first frame.
     */
    const feed = new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 120);
      if (document.getElementById('cid-home-feed')) {
        window.clearTimeout(timer);
        resolve();
        return;
      }
      window.addEventListener('cid:feed-rendered', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    window.__cidRegisterContentReady(feed);
  }

  function startBackgroundWork() {
    // Warm access data without putting it on the navigation critical path.
    window.cidFeatureAccess?.preload?.().catch?.(() => {});
    if (typeof window.preloadSiteAssets === 'function') {
      Promise.resolve(window.preloadSiteAssets({ section: requestedSection })).catch(() => {});
    }
    // Dedicated routes own their own data hydration. Keep the home feed's
    // heavier refreshes off-screen when a reload restores another section.
    if (requestedSection === 'accueil'
      && typeof window.generateLottoResults === 'function') {
      const parallelWarmups = [
        Promise.resolve(window.generateLottoResults()).catch(() => {})
      ];
      window.cidStartMatrixBoundaryRefresh?.();
      if (typeof window.refreshAllPrograms === 'function') {
        parallelWarmups.push(
          Promise.resolve(window.refreshAllPrograms({ forceNetwork: false }))
            .catch(() => {})
        );
      }
      // Both current-programme warmups start in the same turn; neither is
      // awaited by the shell or by the other component.
      void Promise.allSettled(parallelWarmups);
      // The feed shell is mounted synchronously; cached blocks paint now and
      // each remote component revalidates independently after the first frame.
      registerHomeContentReady();
    }
  }

  async function releaseWhenReady() {
    try {
      await window.__cidRenderReadiness?.waitForRenderReadiness?.();
    } catch (error) {
      console.warn('Render readiness fallback used.', error);
    } finally {
      await window.__cidRevealApplication?.();
      if (!window.__cidRevealApplication) {
        document.documentElement.classList.add('cid-render-ready');
        window.__cidRenderReady = true;
        document.body?.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function init() {
    /*
     * The persisted hint is enough to choose the initial route. A remote
     * session read is still started below; render readiness will release the
     * shell only after the native load boundary and its late layout work have
     * settled, so the final load frame cannot move the chrome.
     */
    const hintedState = readSessionHint() || { session: null, user: null };
    const authStatePromise = resolveInitialSession();
    const authState = hintedState;
    document.documentElement.dataset.cidAuthState = authState?.user?.id
      ? 'authenticated'
      : 'visitor';
    routeImmediately(authState);
    startBackgroundWork();
    await releaseWhenReady().catch(() => {});
    // Finish the best-effort session check after the first frame is available.
    // Account hydration owns its own current-session refresh, so this result
    // is only used to keep the route metadata accurate.
    authStatePromise.then((resolvedState) => {
      document.documentElement.dataset.cidAuthState = resolvedState?.user?.id
        ? 'authenticated'
        : 'visitor';
      if (requestedAccount && resolvedState?.user?.id) {
        window.__cidInitialSessionUser = resolvedState.user;
      }
    }).catch(() => {});
    document.documentElement.classList.remove('cid-booting');
    window.__cidBackgroundReady = true;
    window.__cidOfficialVersion = Object.freeze({
      tag: 'official',
      applied_at: new Date().toISOString(),
      source: 'bootstrap.js'
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
