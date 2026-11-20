/*
 * Component isolation coordinator.
 *
 * This module does not own business data. It only owns the cross-component
 * contract: stable host attributes, local first-paint skeletons and a
 * refresh indicator that never clears a sibling surface.
 */

(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  let homeFrame = 0;

  function ensureHomeSkeleton(results) {
    if (!results || get('cid-home-skeleton')) return get('cid-home-skeleton');
    const skeleton = document.createElement('div');
    skeleton.id = 'cid-home-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
      <article class="cid-home-skeleton-card cid-home-skeleton-card--cross">
        <span class="cid-skeleton-line"></span>
        <span class="cid-skeleton-line cid-skeleton-line--short"></span>
        <span class="cid-skeleton-block cid-skeleton-block--cross"></span>
        <span class="cid-skeleton-line cid-skeleton-line--short"></span>
      </article>
      <article class="cid-home-skeleton-card">
        <span class="cid-skeleton-line"></span>
        <span class="cid-skeleton-line cid-skeleton-line--short"></span>
        <span class="cid-skeleton-block"></span>
        <span class="cid-skeleton-line cid-skeleton-line--short"></span>
      </article>`;
    results.prepend(skeleton);
    return skeleton;
  }

  function isHomeRoute() {
    const body = document.body;
    return !body?.dataset?.cidDedicatedView
      && !body?.classList.contains('categories-active')
      && !body?.classList.contains('tableaux-active')
      && !body?.classList.contains('archive-active');
  }

  function syncHomeSkeleton() {
    homeFrame = 0;
    const results = get('results');
    if (!results) return;
    const skeleton = ensureHomeSkeleton(results);
    const feed = get('cid-home-feed');
    const visible = isHomeRoute() && !feed;
    skeleton.hidden = !visible;
    skeleton.setAttribute('aria-hidden', String(!visible));
    results.dataset.cidState = feed
      ? (feed.dataset.feedState || 'ready')
      : visible ? 'loading' : 'inactive';
  }

  function scheduleHomeSkeletonSync() {
    if (homeFrame) return;
    homeFrame = window.requestAnimationFrame(syncHomeSkeleton);
  }

  function markHosts() {
    const hosts = [
      ['results', 'home'],
      ['tableauxViewContainer', 'tableaux'],
      ['historyViewContainer', 'history']
    ];
    hosts.forEach(([id, name]) => {
      const host = get(id);
      if (!host) return;
      host.dataset.cidComponent = name;
      host.dataset.cidIsolation = 'layout-paint-style';
    });
  }

  function bind() {
    markHosts();
    syncHomeSkeleton();

    const results = get('results');
    if (results) {
      const observer = new MutationObserver(scheduleHomeSkeletonSync);
      observer.observe(results, { childList: true, subtree: false });
      window.addEventListener('cid:home-view-restored', scheduleHomeSkeletonSync);
      window.addEventListener('cid:feed-rendered', scheduleHomeSkeletonSync);
    }

    document.body?.addEventListener('transitionend', scheduleHomeSkeletonSync, {
      passive: true
    });

    window.cidIsolatedComponents = Object.freeze({
      syncHomeSkeleton: scheduleHomeSkeletonSync,
      markHosts
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
