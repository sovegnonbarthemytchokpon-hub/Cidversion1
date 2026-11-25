/*
 * Affichage sécurisé Cidmap.
 *
 * Unique source de vérité pour le rendu des surfaces verrouillées. Les
 * valeurs sont immuables et ne dépendent ni du cache navigateur, ni d'un
 * ancien rendu, ni d'une réponse réseau non vérifiée. Les zéros servent de
 * gabarit lisible lorsqu'un résultat est masqué par l'absence d'abonnement.
 */
export const LOCKED_VALUE = '00';
export const LOCKED_KEY_ORDER = '000000';

export const LOCKED_CROSS = Object.freeze({
  top: '0',
  bottom: '0',
  left: '0',
  right: '0'
});

function format(type, position = '') {
  if (type === 'key' || type === 'order') return LOCKED_KEY_ORDER;
  if (type === 'cross') return LOCKED_CROSS[position] || '0';
  if (type === 'combination') return '00 + 00';
  return LOCKED_VALUE;
}

export function isVerifiedActiveSubscription(access) {
  // Any one valid plan with a server end date (cumulative plans).
  const union = typeof window !== 'undefined' ? window.cidSubscriptionUnion : null;
  if (union) {
    return union.validPlans(access).some((entry) => (
      Number.isFinite(Date.parse(entry.subscription.expires_at || ''))
    ));
  }
  const subscription = access?.subscription;
  if (!subscription || subscription.status !== 'active') return false;
  const startedAt = subscription.started_at
    ? Date.parse(subscription.started_at)
    : NaN;
  if (Number.isFinite(startedAt) && startedAt > Date.now()) return false;
  const expiresAt = Date.parse(subscription.expires_at || '');
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export const SECURE_DISPLAY = Object.freeze({
  format,
  keyOrder: LOCKED_KEY_ORDER,
  tableValue: LOCKED_VALUE,
  tableCombination: '00 + 00',
  cross: LOCKED_CROSS,
  isVerifiedActiveSubscription
});

if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'affichageSecurise', {
      value: SECURE_DISPLAY,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (_) {}
  try {
    Object.defineProperty(window, 'cidSecureDisplay', {
      value: SECURE_DISPLAY,
      writable: false,
      configurable: false,
      enumerable: false
    });
  } catch (_) {}
}
