/*
 * Réactif au mode de monétisation global défini par l'administrateur.
 *
 * Source unique : `payment_settings.currency_mode` dans Supabase, renvoyé par
 * l’Edge Function `subscription-access` et piloté depuis le tableau
 * administrateur. Toutes les surfaces qui affichent un solde s’abonnent à cet
 * état pour n’afficher que la devise réellement active.
 */
(function initCidCurrencyMode() {
  'use strict';

  const MODES = ['stars', 'tokens', 'both'];
  const listeners = new Set();
  let current = '';

  function normalize(value) {
    const mode = String(value || '').trim().toLowerCase();
    return MODES.includes(mode) ? mode : '';
  }

  function read() {
    if (typeof window.cidSiteConfig?.currencyMode === 'function') {
      return normalize(window.cidSiteConfig.currencyMode());
    }
    return normalize(window.cidSiteConfig?.state?.()?.paymentSettings?.currency_mode);
  }

  function emit() {
    const next = read();
    if (next === current) return;
    current = next;
    window.dispatchEvent(new CustomEvent('cid:monetization-changed', { detail: { mode: current, currencies: activeCurrencies() } }));
    listeners.forEach((listener) => {
      try {
        listener(current);
      } catch (_) {}
    });
  }

  async function sync() {
    try {
      await (
        window.cidSiteConfig?.refresh?.()
        || window.cidSiteConfig?.load?.()
      );
    } catch (_) {}
    emit();
  }

  function activeCurrencies() {
    return current === 'both' ? ['stars', 'tokens'] : current ? [current] : [];
  }

  function enabled(currency) {
    return Boolean(current) && (current === 'both' || current === currency);
  }

  function subscribe(listener) {
    if (typeof listener === 'function') listeners.add(listener);
    const value = read();
    if (value !== current) {
      current = value;
      window.dispatchEvent(new CustomEvent('cid:monetization-changed', { detail: { mode: current, currencies: activeCurrencies() } }));
    }
    return () => listeners.delete(listener);
  }

  window.cidCurrencyMode = Object.freeze({
    get: () => current,
    activeCurrencies,
    enabled,
    subscribe,
    sync,
    reset: () => {
      current = read();
    }
  });

  window.addEventListener('cid:site-config-loaded', emit);
  window.addEventListener('cid:admin-config-updated', sync);
  window.addEventListener('cid:admin-access-updated', sync);

  if (document.readyState !== 'loading') sync();
  else document.addEventListener('DOMContentLoaded', sync, { once: true });
  // The site configuration owns its refresh schedule (16:00 UTC boundary
  // and stale resume); every refresh emits cid:site-config-loaded above, so
  // no extra polling request is sent from here.
})();
