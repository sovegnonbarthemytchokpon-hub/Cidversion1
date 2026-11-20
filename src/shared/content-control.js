/*
 * Réactif au contrôle de contenu administrateur : état global/granulaire des
 * commentaires et verrouillage chirurgical des contenus (croix, matrice,
 * boules rejetées, tableaux, catégories).
 *
 * Source unique : la configuration Supabase exposée par les services
 * administrateur. Toutes les surfaces (flux de publications, sections
 * verrouillables) interrogent ce helper pour afficher uniquement ce que
 * l'administrateur autorise.
 */
(function initCidContentControl() {
  'use strict';

  const listeners = new Set();

  function commentsEnabledFor(drawId, type) {
    if (typeof window.cidSiteConfig?.commentsEnabled === 'function') {
      return window.cidSiteConfig.commentsEnabled(drawId, type);
    }
    // Fail closed while the public configuration is loading or unavailable.
    // This prevents comment controls from flashing before the administrator's
    // explicit decision is known.
    return false;
  }

  function lockFor(type, key, countryCode) {
    if (typeof window.cidSiteConfig?.lockFor === 'function') {
      return window.cidSiteConfig.lockFor({ type, key, countryCode });
    }
    return null;
  }

  function subscribe(listener) {
    if (typeof listener === 'function') listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit() {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (_) {}
    });
  }

  window.cidContentControl = Object.freeze({
    commentsEnabled: commentsEnabledFor,
    lockFor,
    subscribe
  });

  window.addEventListener('cid:site-config-loaded', emit);
  window.addEventListener('cid:admin-config-updated', emit);
  window.addEventListener('cid:admin-access-updated', emit);
})();
