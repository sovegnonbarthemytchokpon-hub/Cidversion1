/*
 * Synchronise every visible counter from the per-user stats store.
 * The profile view is mounted dynamically, so rendering uses all matching
 * elements instead of relying on a single duplicate DOM id.
 */
(function initCidHeaderSync() {
  'use strict';

  const SESSION_KEY = 'cidgroup.session.v1';
  const getStats = () => window.cidUserStats?.get() || { etoilesGagnees: 0, jetons: 0, nombrePartages: 0 };

  function currencyEnabled(currency) {
    return typeof window.cidCurrencyMode?.enabled === 'function'
      ? window.cidCurrencyMode.enabled(currency)
      : true;
  }

  function updateCounter(element, value, buttonSelector, changed) {
    if (element.textContent !== value) {
      element.textContent = value;
      changed && changed.add(buttonSelector);
    }
    element.dataset.cidManaged = 'true';
  }

  function render() {
    const stats = getStats();
    const stars = String(stats.etoilesGagnees);
    const tokens = String(stats.jetons || 0);
    const shares = String(stats.nombrePartages);
    const changed = new Set();

    const starsVisible = currencyEnabled('stars');
    const tokensVisible = currencyEnabled('tokens');

    document.querySelectorAll('#starPoints, #profileStarPoints').forEach((element) => {
      element.hidden = !starsVisible;
      updateCounter(element, stars, '#starBtn', changed);
    });
    document.querySelectorAll('#tokenPoints').forEach((element) => {
      element.hidden = !tokensVisible;
      updateCounter(element, tokens, '#starBtn', changed);
    });
    document.querySelectorAll('#sharePoints, #profileSharedLinks').forEach((element) => {
      updateCounter(element, shares, '#shareBtn', changed);
    });
    const walletButton = document.querySelector('#starBtn');
    if (walletButton) {
      walletButton.classList.toggle('cid-wallet-single', !(starsVisible && tokensVisible));
      const label = starsVisible && tokensVisible
        ? 'Voir mon solde d’étoiles et de jetons'
        : starsVisible ? 'Voir mon solde d’étoiles' : 'Voir mon solde de jetons';
      walletButton.setAttribute('aria-label', label);
    }
    changed.forEach((selector) => {
      document.querySelectorAll(selector).forEach((button) => {
        button.classList.remove('cid-counter-bump');
        void button.offsetWidth;
        button.classList.add('cid-counter-bump');
      });
    });
  }

  function init() {
    render();
    window.cidUserStats?.subscribe(render);
    window.cidCurrencyMode?.subscribe?.(render);
    window.addEventListener('cid:auth-sync', render);
    window.addEventListener('cid:monetization-changed', render);
    window.addEventListener('storage', (event) => {
      if (event.key === SESSION_KEY) render();
    });
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'cid-auth-sync' || event.data?.type === 'cid-referral-sync') render();
    });

    // The Profile dashboard is injected after this script has run.
    // One header sync per frame, not one per DOM mutation batch.
    let renderFrame = 0;
    const observer = new MutationObserver(() => {
      if (renderFrame) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        render();
      });
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
