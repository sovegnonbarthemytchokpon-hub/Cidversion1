/*
 * Scroll stability contract.
 *
 * Route controllers own their isolated scroll surface. The document remains
 * available for normal page scrolling, while modal locks are explicit and
 * transient. Keep this controller dependency-free and load it before routes.
 */
(() => {
  'use strict';

  const BODY_LOCK_CLASSES = [
    'modal-open', 'no-scroll', 'noscroll', 'scroll-lock',
    'overflow-hidden', 'is-locked'
  ];

  const ROUTE_SURFACES = [
    '#results', '#categoriesView', '#tableauxViewContainer',
    '#profileViewContainer', '#croixViewContainer', '#matrixCalculatorPanel',
    '#anticipationViewContainer', '#resultatAideViewContainer',
    '#globalStatisticsViewContainer', '#virtualAssistantViewContainer',
    '#notificationCenter'
  ].join(', ');

  /*
   * Prefer native touch scrolling in every route and nested table. In
   * particular, don't constrain touch-action to pan-y: horizontal overflow
   * tables need to accept sideways gestures without cancelling vertical ones.
   * `manipulation` keeps both pan axes plus pinch-zoom and is the most widely
   * supported non-default value (Android Chrome, Safari, Firefox, Opera).
   */
  /*
   * Lightweight browsers (Opera Mini, very old WebViews) can't scroll inside
   * fixed containers. Let the document scroll for them instead; see the
   * `html.cid-document-scroll` rules in app.css.
   */
  const needsDocumentScroll = (() => {
    try {
      const ua = navigator.userAgent || '';
      if (window.operamini || /Opera Mini|OPiOS\/[0-8]\./i.test(ua)) return true;
      if (window.CSS && typeof CSS.supports === 'function') {
        return !(CSS.supports('position', 'sticky')
          || CSS.supports('position', '-webkit-sticky'));
      }
      return !window.CSS;
    } catch (_) {
      return false;
    }
  })();
  if (needsDocumentScroll) document.documentElement.classList.add('cid-document-scroll');

  const SCROLL_STYLE_ID = 'cid-native-scroll-contract';
  function installNativeScrollContract() {
    if (document.getElementById(SCROLL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SCROLL_STYLE_ID;
    style.textContent = `
      html, body { touch-action: manipulation !important; }
      html:not(.cid-scroll-locked), body:not(.cid-scroll-locked) {
        overscroll-behavior-y: auto !important;
      }
      ${ROUTE_SURFACES},
      .cid-layout-surface,
      .profile-native-host,
      .modal-body,
      #archiveContent,
      .notification-list {
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
        touch-action: manipulation;
        scroll-behavior: auto;
      }
      #tableauxViewContainer,
      #results,
      .profile-native-host,
      .cid-layout-surface {
        min-height: 0;
        scroll-padding-block: 12px;
      }
      #tableauxViewContainer .table-container,
      #tableauxViewContainer .satellites-table-container,
      #tableauxViewContainer .created-program-template-satellites,
      .cid-layout-surface .table-container,
      .cid-layout-surface .table-responsive {
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        overscroll-behavior-y: auto;
        touch-action: manipulation;
      }
      #tableauxViewContainer table,
      .cid-layout-surface table { scroll-margin-block: 12px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  installNativeScrollContract();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installNativeScrollContract, { once: true });
  }

  const syncVisualViewportGeometry = () => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const measuredOffsetTop = Math.max(0, Number(viewport?.offsetTop) || 0);
    const seededOffsetTop = Math.max(
      0,
      parseFloat(root.style.getPropertyValue('--cid-visual-offset-top')) || 0
    );
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
    const bottomExtension = Math.max(0, visibleHeight + offsetTop - layoutHeight);
    root.style.setProperty('--cid-visual-offset-top', `${offsetTop}px`);
    root.style.setProperty('--cid-visual-height', `${visibleHeight}px`);
    root.style.setProperty('--cid-visual-bottom-extension', `${bottomExtension}px`);
    syncBottomNavOccupancy();
  };

  let lastNavOccupancy = -1;
  function syncBottomNavOccupancy() {
    const root = document.documentElement;
    const nav = document.querySelector('.category-bar');
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    const viewport = window.visualViewport;
    const visibleBottom = (Number(viewport?.offsetTop) || 0)
      + (Number(viewport?.height) || window.innerHeight || root.clientHeight || 0);
    const hidden = rect.height <= 0 || getComputedStyle(nav).display === 'none';
    const occupied = hidden ? 0 : Math.max(0, Math.ceil(visibleBottom - rect.top));
    if (occupied === lastNavOccupancy) return;
    lastNavOccupancy = occupied;
    root.style.setProperty('--cid-bottom-nav-occupied', `${occupied}px`);
  }

  const observeBottomNav = () => {
    const nav = document.querySelector('.category-bar');
    if (!nav) return false;
    syncBottomNavOccupancy();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(syncBottomNavOccupancy).observe(nav);
    }
    return true;
  };
  if (!observeBottomNav()) {
    document.addEventListener('DOMContentLoaded', observeBottomNav, { once: true });
  }

  syncVisualViewportGeometry();
  // visualViewport scroll fires repeatedly as iOS browser chrome moves. Updating
  // layout variables on every event changes fixed-surface height mid-gesture;
  // resize/orientation/pageshow are sufficient to resynchronize geometry.
  window.visualViewport?.addEventListener('resize', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('resize', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('orientationchange', syncVisualViewportGeometry, { passive: true });
  window.addEventListener('pageshow', syncVisualViewportGeometry, { passive: true });
  [50, 180, 420, 900].forEach((delay) => window.setTimeout(syncVisualViewportGeometry, delay));

  const activeTouchAction = () => 'manipulation';

  const setDocumentScroll = (locked) => {
    const root = document.documentElement;
    const body = document.body;
    [root, body].filter(Boolean).forEach((element) => {
      element.style.setProperty('overflow-y', locked ? 'hidden' : 'auto', 'important');
      element.style.setProperty('overflow-x', 'hidden', 'important');
      element.style.setProperty('overscroll-behavior-y', locked ? 'none' : 'auto', 'important');
      element.style.setProperty('touch-action', activeTouchAction(), 'important');
      element.classList.toggle('cid-scroll-locked', locked);
      element.classList.toggle('modal-open', locked);
      element.classList.toggle('no-scroll', locked);
    });
    if (body) BODY_LOCK_CLASSES.forEach((className) => body.classList.toggle(className, locked));
  };

  const closeOpenModals = () => {
    document.querySelectorAll('.modal-overlay.open, .modal.open').forEach((modal) => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
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
    const shellIsBooting = root?.classList.contains('cid-booting')
      || window.__cidRenderReady !== true;
    [root, body].filter(Boolean).forEach((element) => {
      element.style.removeProperty('overflow');
      element.style.setProperty('overflow-y', shellIsBooting ? 'hidden' : 'auto', 'important');
      element.style.setProperty('overflow-x', 'hidden', 'important');
      element.style.setProperty('overscroll-behavior-y', 'auto', 'important');
      element.style.setProperty('touch-action', activeTouchAction(), 'important');
      BODY_LOCK_CLASSES.forEach((className) => element.classList.remove(className));
      element.classList.remove('cid-scroll-locked');
    });
    if (body) {
      Array.from(body.classList).forEach((className) => {
        if (/(?:modal|scroll|overflow|no-?scroll)/i.test(className)) body.classList.remove(className);
      });
    }
    if (resetSurfaces) {
      try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch (_) {}
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
    requestAnimationFrame(resetColdDocumentPosition);
  }, { once: true });
  window.addEventListener('pageshow', resetColdDocumentPosition, { once: true });

  /*
   * History changes are not necessarily route changes (filters and tabs also
   * use pushState). Never reset every scroll owner just because the URL was
   * updated; the destination route controller explicitly resets its own view.
   */
  ['pushState', 'replaceState'].forEach((method) => {
    const original = window.history?.[method];
    if (typeof original !== 'function') return;
    window.history[method] = function stableScrollHistoryMethod(...args) {
      const result = original.apply(this, args);
      resetScroll({ resetSurfaces: false });
      return result;
    };
  });
  window.addEventListener('popstate', () => resetScroll({ resetSurfaces: false }));
})();
