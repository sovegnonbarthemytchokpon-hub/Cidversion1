/*
 * Component runtime contract.
 *
 * The page is a collection of independent blocks, not one async view. This
 * small runtime gives every block two guarantees:
 *   1. its geometry is reserved before data arrives and is never virtualized;
 *   2. a previously validated, public payload can be painted synchronously
 *      from localStorage while the network revalidates in the background.
 *
 * Only public/presentation-safe payloads should use this cache. Entitlement
 * checks remain authoritative for protected Tableaux and anticipation data.
 */
(() => {
  'use strict';

  const CACHE_VERSION = 3;
  const CACHE_PREFIX = 'cidmap:component-cache:v40:';
  const memory = new Map();
  const observedRoots = new WeakSet();
  const observedBlocks = new WeakSet();

  const DEFAULT_MIN_HEIGHTS = Object.freeze({
    home: 720,
    cross: 430,
    matrix: 390,
    rejected: 430,
    anticipation: 220,
    tableaux: 520,
    history: 390,
    generic: 180
  });

  function normalize(value) {
    return String(value || '')
      .trim()
      .replace(/[^A-Za-z0-9._:@/-]+/g, '_')
      .slice(0, 180) || 'default';
  }

  function cacheKey(key, identity = 'visitor') {
    return `${CACHE_PREFIX}${normalize(identity)}:${normalize(key)}`;
  }

  function storageRead(key, identity = 'visitor') {
    const fullKey = cacheKey(key, identity);
    if (memory.has(fullKey)) return memory.get(fullKey);
    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) return null;
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.version !== CACHE_VERSION) return null;
      memory.set(fullKey, envelope);
      return envelope;
    } catch (_) {
      return null;
    }
  }

  function read(key, {
    identity = 'visitor',
    maxAgeMs = 36 * 60 * 60 * 1000
  } = {}) {
    const envelope = storageRead(key, identity);
    if (!envelope || !Number.isFinite(Number(envelope.savedAt))) return null;
    const age = Math.max(0, Date.now() - Number(envelope.savedAt));
    return {
      value: envelope.value,
      savedAt: Number(envelope.savedAt),
      age,
      stale: age > maxAgeMs
    };
  }

  function write(key, value, {
    identity = 'visitor',
    meta = null
  } = {}) {
    const envelope = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      meta: meta && typeof meta === 'object' ? meta : null,
      value
    };
    const fullKey = cacheKey(key, identity);
    memory.set(fullKey, envelope);
    try {
      localStorage.setItem(fullKey, JSON.stringify(envelope));
      return true;
    } catch (_) {
      // Private browsing and quota errors must never block a live request.
      return false;
    }
  }

  function remove(key, identity = 'visitor') {
    const fullKey = cacheKey(key, identity);
    memory.delete(fullKey);
    try { localStorage.removeItem(fullKey); } catch (_) {}
  }

  function identity() {
    return String(
      window.cidAuthCurrentUserId
      || window.cidAuth?.getCurrentProfile?.()?.uid
      || 'visitor'
    ).trim() || 'visitor';
  }

  function cacheFirst({
    key,
    loader,
    apply,
    validate = () => true,
    identity: cacheIdentity = identity(),
    maxAgeMs = 36 * 60 * 60 * 1000,
    revalidate = true
  }) {
    const cached = read(key, {
      identity: cacheIdentity,
      maxAgeMs
    });
    if (cached && validate(cached.value)) {
      try { apply?.(cached.value, { cached: true, stale: cached.stale }); } catch (_) {}
    }

    if (typeof loader !== 'function' || (!revalidate && cached)) {
      return Promise.resolve(cached?.value ?? null);
    }

    return Promise.resolve()
      .then(loader)
      .then((value) => {
        if (!validate(value)) throw new Error('Payload de composant invalide.');
        write(key, value, { identity: cacheIdentity });
        apply?.(value, { cached: false, stale: false });
        return value;
      })
      .catch((error) => {
        // A stale but valid paint is still preferable to a blank component
        // when the network is temporarily unavailable.
        if (cached && validate(cached.value)) return cached.value;
        throw error;
      });
  }

  function componentType(element) {
    if (!element) return 'generic';
    const explicit = String(
      element.dataset.cidBlock
      || element.dataset.cidComponent
      || ''
    ).trim().toLowerCase();
    if (explicit) return explicit;
    if (element.matches('#cid-home-feed')) return 'home';
    if (element.matches('[data-post-type="cross"], #redCross, #redCrossClone')) return 'cross';
    if (element.matches('[data-post-type="matrix"]')) return 'matrix';
    if (element.matches('[data-post-type="rejected"]')) return 'rejected';
    if (element.matches('[data-anticipation-feature]')) return 'anticipation';
    if (element.matches('[data-tableaux-route], .tableaux-program-stack')) return 'tableaux';
    return 'generic';
  }

  function minHeightFor(element, type = componentType(element)) {
    const explicit = Number(element?.dataset?.cidMinHeight);
    return Number.isFinite(explicit) && explicit > 0
      ? explicit
      : DEFAULT_MIN_HEIGHTS[type] || DEFAULT_MIN_HEIGHTS.generic;
  }

  function mark(element, {
    type = componentType(element),
    minHeight = minHeightFor(element, type)
  } = {}) {
    if (!element || !(element instanceof Element)) return element;
    element.dataset.cidBlock = type;
    element.dataset.cidMounted = 'true';
    element.style.setProperty('--cid-block-min-height', `${Math.max(1, minHeight)}px`);
    element.classList.add('cid-stable-block');
    if (!observedBlocks.has(element)) {
      observedBlocks.add(element);
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(([entry]) => {
          const height = Math.ceil(entry?.contentRect?.height || 0);
          if (height > minHeightFor(element, type)) {
            element.style.setProperty('--cid-block-min-height', `${height}px`);
          }
        });
        observer.observe(element);
      }
    }
    return element;
  }

  function scan(root = document) {
    if (!root?.querySelectorAll) return;
    const selectors = [
      '#cid-home-feed',
      '#cid-home-feed > .cid-fb-post',
      '[data-tableaux-route]',
      '.anticipation-feed > [data-anticipation-feature]',
      '#historyViewContainer',
      '#historyViewMount',
      '#cidHistoryResults',
      '#rejectedContent',
      '#rejectedInlineMain',
      '#rejectedInlineContainer',
      '#redCross',
      '#redCrossClone'
    ].join(', ');
    if (root instanceof Element && root.matches(selectors)) mark(root);
    root.querySelectorAll(selectors).forEach((element) => mark(element));
  }

  function observe(root = document) {
    scan(root);
    if (root === document) {
      /*
       * Observe only application surfaces. Watching the entire document
       * would turn every unrelated modal/social mutation into work on mobile.
       */
      [
        document.getElementById('results'),
        document.getElementById('tableauxViewContainer'),
        document.getElementById('anticipationViewMount'),
        document.getElementById('croixViewContainer'),
        document.getElementById('historyViewContainer')
      ].filter(Boolean).forEach((surface) => observe(surface));
      return;
    }
    if (observedRoots.has(root) || typeof MutationObserver !== 'function') return;
    observedRoots.add(root);
    const observer = new MutationObserver((mutations) => {
      // We only add/mark nodes. Existing component subtrees are never
      // removed, replaced or hidden by this observer.
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        });
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  window.cidComponentRuntime = Object.freeze({
    cache: Object.freeze({
      version: CACHE_VERSION,
      identity,
      key: cacheKey,
      read,
      write,
      remove,
      cacheFirst
    }),
    defaults: DEFAULT_MIN_HEIGHTS,
    mark,
    scan,
    observe
  });

  const boot = () => observe(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
