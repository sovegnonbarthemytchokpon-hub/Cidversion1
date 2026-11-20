/*
 * Scroll stability contract.
 *
 * The application uses fixed, independently scrollable route surfaces. The
 * document itself must therefore never retain a stale modal lock when a
 * route changes. This small, dependency-free controller is loaded before the
 * route modules so every navigation path can release the same state.
 */
(() => {
  'use strict';

  const BODY_LOCK_CLASSES = [
    'modal-open',
    'no-scroll',
    'noscroll',
    'scroll-lock',
    'overflow-hidden',
    'is-locked'
  ];

  const ROUTE_SURFACES = [
    '#results',
    '#categoriesView',
    '#tableauxViewContainer',
    '#profileViewContainer',
    '#croixViewContainer',
    '#matrixCalculatorPanel',
    '#anticipationViewContainer',
    '#resultatAideViewContainer',
    '#globalStatisticsViewContainer',
    '#virtualAssistantViewContainer',
    '#notificationCenter'
  ].join(', ');

  /*
   * Keep the current visual viewport available to overlays and keyboard-aware
   * surfaces. The persistent header/navigation use ordinary fixed positioning
   * so Safari can move them with its own browser chrome transitions.
   */
  const syncVisualViewportGeometry = () => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const measuredOffsetTop = Math.max(0, Number(viewport?.offsetTop) || 0);
    const seededOffsetTop = Math.max(
      0,
      parseFloat(root.style.getPropertyValue('--cid-visual-offset-top')) || 0
    );
    /*
     * During Safari's first layout pass visualViewport can briefly report
     * zero after the parser already measured the real browser-chrome offset.
     * Do not overwrite that seeded value with a transient zero while the
     * splash is still covering the page.
     */
    const offsetTop = measuredOffsetTop > 0
      || !root.classList.contains('cid-booting')
      ? measuredOffsetTop
      : seededOffsetTop;
    const visibleHeight = Math.max(
      1,
      Number(viewport?.height) || window.innerHeight || root.clientHeight || 1
    );
    const layoutHeight = Math.max(
      1,
      root.clientHeight || window.innerHeight || visibleHeight
    );
    const bottomExtension = Math.max(
      0,
      visibleHeight + offsetTop - layoutHeight
    );
    root.style.setProperty('--cid-visual-offset-top', `${offsetTop}px`);
    root.style.setProperty('--cid-visual-height', `${visibleHeight}px`);
    root.style.setProperty('--cid-visual-bottom-extension', `${bottomExtension}px`);
  };

  syncVisualViewportGeometry();
  window.visualViewport?.addEventListener('resize', syncVisualViewportGeometry, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('resize', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('orientationchange', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('pageshow', syncVisualViewportGeometry, { passive: true });

  /*
   * iOS Safari can publish the first visualViewport dimensions a little after
   * the document's load event. Re-read them during the boot window so the
   * first visible frame does not use the layout viewport and leave the header
   * behind the address bar or the navigation above a grey tail.
   */
  [50, 180, 420, 900].forEach((delay) => {
    window.setTimeout(syncVisualViewportGeometry, delay);
  });

  const activeTouchAction = () => (
    document.body?.classList.contains('croix-active')
      || document.body?.dataset?.cidDedicatedView === 'croix'
      ? 'pan-x pan-y'
      : 'pan-y'
  );

  const setDocumentScroll = (locked) => {
    const value = locked ? 'hidden' : 'auto';
    const root = document.documentElement;
    const body = document.body;
    [root, body].filter(Boolean).forEach((element) => {
      element.style.setProperty('overflow-y', value, 'important');
      element.style.setProperty('overflow-x', 'hidden', 'important');
      element.style.setProperty('overscroll-behavior-y', 'none', 'important');
      element.style.setProperty('touch-action', activeTouchAction(), 'important');
      element.classList.toggle('modal-open', locked);
      element.classList.toggle('no-scroll', locked);
    });
    if (body) {
      BODY_LOCK_CLASSES.forEach((className) => {
        if (!locked || className === 'modal-open' || className === 'no-scroll') {
          body.classList.toggle(className, locked);
        }
      });
    }
  };

  const closeOpenModals = () => {
    document.querySelectorAll('.modal-overlay.open, .modal.open').forEach((modal) => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      // A few legacy handlers use inline display values, so clear those too.
      modal.style.display = 'none';
    });
    document.querySelectorAll('[aria-expanded="true"]').forEach((element) => {
      element.setAttribute('aria-expanded', 'false');
    });
  };

  const resetScroll = ({ closeModals = false, resetSurfaces = true } = {}) => {
    if (closeModals) closeOpenModals();

    const root = document.documentElement;
    const body = document.body;
    /*
     * Route initialization calls this reset before the splash gate is
     * released. Keep the document locked during that window so its inline
     * `overflow-y: auto` value cannot reintroduce the cold-load coordinate
     * jump that the shell CSS is preventing.
     */
    const shellIsBooting = root?.classList.contains('cid-booting')
      || window.__cidRenderReady !== true;
    const documentOverflow = shellIsBooting ? 'hidden' : 'auto';
    [root, body].filter(Boolean).forEach((element) => {
      element.style.removeProperty('overflow');
      element.style.setProperty('overflow-y', documentOverflow, 'important');
      element.style.setProperty('overflow-x', 'hidden', 'important');
      element.style.setProperty('overscroll-behavior-y', 'none', 'important');
      element.style.setProperty('touch-action', activeTouchAction(), 'important');
      BODY_LOCK_CLASSES.forEach((className) => element.classList.remove(className));
    });

    if (body) {
      // Be defensive against classes added by older integrations.
      Array.from(body.classList).forEach((className) => {
        if (/(?:modal|scroll|overflow|no-?scroll)/i.test(className)) {
          body.classList.remove(className);
        }
      });
    }

    if (resetSurfaces) {
      try { window.scrollTo(0, 0); } catch (_) {}
      document.querySelectorAll(ROUTE_SURFACES).forEach((surface) => {
        try {
          surface.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
          surface.scrollTop = 0;
          surface.scrollLeft = 0;
        } catch (_) {}
      });
    }
  };

  window.cidSetDocumentScrollLocked = setDocumentScroll;
  window.cidResetScrollLock = resetScroll;
  window.cidCloseOpenModals = closeOpenModals;

  /*
   * Some mobile browsers restore the document position once the native load
   * event completes, after the early bootstrap reset has already run. That
   * restoration moves the fixed shell as a whole and is perceived as the
   * header disappearing with a blank tail below it. Re-assert the cold
   * position at that boundary, but never disturb a visitor who has already
   * interacted with a route.
   */
  const resetColdDocumentPosition = () => {
    if (window.__cidRenderReady === true
      && !document.documentElement.classList.contains('cid-booting')) return;
    try { window.scrollTo(0, 0); } catch (_) {}
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    document.querySelectorAll(ROUTE_SURFACES).forEach((surface) => {
      surface.scrollTop = 0;
      surface.scrollLeft = 0;
    });
  };

  window.addEventListener('load', () => {
    resetColdDocumentPosition();
    requestAnimationFrame(() => resetColdDocumentPosition());
  }, { once: true });
  window.addEventListener('pageshow', resetColdDocumentPosition, { once: true });

  // History transitions are also route transitions. Keep this safety net in
  // place for controllers that do not share categories-view.js.
  ['pushState', 'replaceState'].forEach((method) => {
    const original = window.history?.[method];
    if (typeof original !== 'function') return;
    window.history[method] = function stableScrollHistoryMethod(...args) {
      const result = original.apply(this, args);
      resetScroll({ resetSurfaces: true });
      return result;
    };
  });
  window.addEventListener('popstate', () => {
    resetScroll({ resetSurfaces: true });
  });

  /*
   * Scrolling stays entirely native. The previous document-level touchmove
   * listener cancelled downward gestures at the top of a nested surface,
   * which made mobile scrolling feel stuck and forced every touch through a
   * non-passive handler. CSS overscroll containment above is sufficient here.
   */
})();
