/*
 * Point d'entrée unique de paiement Paystack.
 *
 * Paystack ne sert ici qu'à acheter un pack de jetons virtuels.
 * Le navigateur envoie uniquement l'identifiant du pack et l'identité
 * courante récupérée depuis la session. Le serveur recalcule la quantité, la
 * devise et le montant depuis `token_prices`.
 */
(function configurePaystackPayment() {
  'use strict';

  const paymentConfig = window.CIDGROUP_PAYMENT_CONFIG || {};

  function paymentClient() {
    return Promise.resolve(window.cidSupabaseReady)
      .then((bridge) => bridge?.client || null)
      .catch(() => null);
  }

  function responseErrorText(error) {
    return Promise.resolve(error?.context?.text?.())
      .catch(() => '')
      .then((contextText) => contextText || error?.message || 'Erreur inconnue.');
  }

  /*
   * Fonction publique utilisée par les boutons d'achat de jetons.
   *
   * Le montant affiché, la quantité et la devise ne font volontairement
   * jamais partie de la requête. `user_id` et `email` sont envoyés selon le
   * contrat client, mais l'Edge Function les compare à son JWT et ne leur
   * fait pas confiance.
  */
  window.procederAuPaiement = async function procederAuPaiement(
    planId,
    options = {}
  ) {
    const normalizedPlanId = String(planId || '').trim().toLowerCase();
    const normalizedPackId = String(options?.pack_id || '').trim().toLowerCase();
    if (normalizedPlanId !== 'tokens' || !/^[a-z][a-z0-9_-]{2,59}$/.test(normalizedPackId)) {
      alert('Seuls les packs de jetons peuvent être payés par Paystack.');
      return null;
    }

    const supabase = await paymentClient();
    if (!supabase?.auth?.getUser || !supabase?.functions?.invoke) {
      alert('Le service de paiement est indisponible.');
      return null;
    }

    let authResult;
    try {
      authResult = await supabase.auth.getUser();
    } catch (_) {
      alert('Veuillez vous connecter pour effectuer cet achat.');
      return null;
    }
    const { data: { user } = {}, error: userError } = authResult || {};
    if (userError || !user || !user.email) {
      alert('Veuillez vous connecter pour effectuer cet achat.');
      return null;
    }

    const paymentBody = {
      pack_id: normalizedPackId,
      user_id: String(user.id).trim(),
      email: String(user.email).trim().toLowerCase()
    };

    let data;
    let error;
    try {
      ({ data, error } = await supabase.functions.invoke('create-paystack-payment', {
        body: paymentBody
      }));
    } catch (invokeError) {
      const errorText = await responseErrorText(invokeError);
      alert('Erreur lors de la création du paiement : ' + errorText);
      return null;
    }

    if (error) {
      const errorText = await responseErrorText(error);
      alert('Erreur lors de la création du paiement : ' + errorText);
      return null;
    }

    const paymentUrl = data?.authorization_url
      || data?.url
      || data?.data?.authorization_url
      || data?.data?.url;
    if (paymentUrl) {
      // Redirection directe vers le guichet sécurisé Paystack.
      window.location.href = paymentUrl;
      return data;
    }

    alert('URL de paiement introuvable dans la réponse serveur.');
    return null;
  };

  /*
   * Raccourci public pour un pack configuré côté serveur. Aucun catalogue
   * local n'est utilisé : l'identifiant est seulement transmis au serveur.
   */
  window.acheterPackJetons = async function acheterPackJetons(packId) {
    const normalizedPackId = String(packId || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{2,59}$/.test(normalizedPackId)) {
      alert('Pack de jetons invalide.');
      return null;
    }

    return window.procederAuPaiement('tokens', {
      pack_id: normalizedPackId
    });
  };

  window.CIDGROUP_PAYMENT_PUBLIC_KEY = paymentConfig.paystackPublicKey
    || 'pk_live_e5cfde4f8075c365b7474953bd035d11c7e6ed58';

  /*
   * Support facultatif des boutons déclaratifs. Les modals principaux
   * branchent directement procederAuPaiement ; ce garde-fou permet à une
   * surface ajoutée ultérieurement de rester sur le même contrat.
   */
  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-paystack-payment]');
    if (!button || button.disabled) return;

    const packId = button.dataset.packId || button.dataset.pack;
    if (!packId) return;

    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await window.procederAuPaiement('tokens', {
        pack_id: packId
      });
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }, true);
})();
