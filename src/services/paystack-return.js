/*
 * Retour Paystack : lecture seule côté navigateur.
 *
 * La query string ne crédite rien. Elle sert uniquement à retrouver la
 * référence créée par create-paystack-payment. Le statut réel vient de
 * paystack-payment-status, puis les soldes sont relus depuis Supabase.
 */
(function initPaystackReturn() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const reference = String(
    params.get('reference') || params.get('trxref') || ''
  ).trim();
  if (!reference) return;

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function getBridge() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (window.cidSupabaseReady) return window.cidSupabaseReady;
      await wait(100);
    }
    return null;
  }

  function cleanCallbackParams() {
    const url = new URL(window.location.href);
    ['reference', 'trxref', 'payment'].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState(
      {},
      document.title,
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  async function paymentStatus(supabase, ref) {
    const response = await supabase.functions.invoke('paystack-payment-status', {
      body: { reference: ref }
    });
    if (response.error) throw response.error;
    return response.data || {};
  }

  async function showSuccess(quantity) {
    // Refreshes are reads only. There is deliberately no UPDATE/RPC credit
    // path in this module.
    await window.cidUserStats?.refresh?.();
    /*
     * The payment credits tokens, not the protected feature itself. Refresh
     * the same entitlement snapshot used by the calculator before opening
     * the wallet so every returning route can immediately distinguish
     * "buy tokens", "unlock the feature", and "already active".
     */
    const access = await Promise.resolve(
      window.cidFeatureAccess?.refresh?.()
    ).catch(() => null);
    window.dispatchEvent(new CustomEvent('cid:payment-validated', {
      detail: { reference, status: 'paid', access }
    }));

    const amount = Number(quantity);
    const message = Number.isFinite(amount) && amount > 0
      ? `Achat validé avec succès ! Votre compte a été crédité de ${amount.toLocaleString(window.cidTranslation?.current?.() || 'fr')} ${window.cidTranslation?.t?.('balance.tokenPlural', 'jetons') || 'jetons'}.`
      : 'Achat validé avec succès ! Votre compte a été crédité. Solde mis à jour.';
    let showPanel = window.cidShowBalancePanel || window.cidOpenBalancePanel;
    for (let attempt = 0; !showPanel && attempt < 20; attempt += 1) {
      await wait(100);
      showPanel = window.cidShowBalancePanel || window.cidOpenBalancePanel;
    }
    if (typeof showPanel === 'function') {
      showPanel({
        notice: message,
        noticeKind: 'success'
      });
    } else {
      // The balance panel can be delayed during the first SPA boot. Keep the
      // message visible without ever turning it into a credit operation.
      window.alert(message);
    }
  }

  async function run() {
    let bridge;
    try {
      bridge = await getBridge();
      const session = await bridge?.auth?.getSession?.();
      if (!session?.data?.session || !bridge?.client?.functions?.invoke) return;

      const storageKey = `cid-paystack-processed:${reference}`;
      try {
        if (sessionStorage.getItem(storageKey) === 'paid') {
          cleanCallbackParams();
          return;
        }
      } catch (_) {}

      // The webhook is authoritative and may arrive just after the browser
      // redirect. Poll only the authenticated owner's status for a short,
      // bounded period.
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const state = await paymentStatus(bridge.client, reference);
        if (state.status === 'paid') {
          try { sessionStorage.setItem(storageKey, 'paid'); } catch (_) {}
          await showSuccess(state.quantity);
          cleanCallbackParams();
          return;
        }
        if (state.status === 'failed') break;
        if (attempt < 14) await wait(2000);
      }
    } catch (error) {
      console.warn('Vérification du paiement Paystack indisponible', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
