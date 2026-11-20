/*
 * Shared Tableaux contract.
 *
 * The live Tableaux view and every historical clone must agree on the same
 * programme ids, feature keys and payload aliases. This module contains no
 * rendering or styling; it only prevents the two routes from drifting apart.
 */

export const TABLEAU_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'universal',
    featureKey: 'tableaux-universelle',
    label: 'Universelle',
    portfolioClass: 'portfolio-universal'
  }),
  Object.freeze({
    id: 'intuition',
    featureKey: 'tableaux-intuition',
    label: 'Intuition',
    portfolioClass: 'portfolio-intuition'
  }),
  Object.freeze({
    id: 'oracle',
    featureKey: 'tableaux-oracle',
    label: 'Oracle',
    portfolioClass: 'portfolio-oracle'
  }),
  Object.freeze({
    id: 'lnb',
    featureKey: 'tableaux-lnb',
    label: 'LNB',
    portfolioClass: 'portfolio-lnb'
  }),
  Object.freeze({
    id: 'balsa',
    featureKey: 'tableaux-balsa',
    label: 'Balsa Plus',
    portfolioClass: 'portfolio-manual'
  }),
  Object.freeze({
    id: 'standby',
    featureKey: 'tableaux-standby',
    label: 'Stand-by',
    portfolioClass: 'portfolio-standby'
  })
]);

export const TABLEAU_PLAN_ALIASES = Object.freeze({
  universal: 'universal',
  universelle: 'universal',
  intuition: 'intuition',
  oracle: 'oracle',
  lnb: 'lnb',
  balsa: 'balsa',
  'balsa-plus': 'balsa',
  manual: 'balsa',
  standby: 'standby',
  'stand-by': 'standby'
});

export function normalizeTableauPlanId(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^tableaux[-_]/, '');
  return TABLEAU_PLAN_ALIASES[raw] || raw;
}

export function normalizeTableauFeatureKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'tableaux-universelle') {
    return raw;
  }
  if (raw === 'tableaux-universal' || raw === 'universelle' || raw === 'universal') {
    return 'tableaux-universelle';
  }
  const planId = normalizeTableauPlanId(raw);
  if (TABLEAU_PLAN_ALIASES[planId]) {
    return `tableaux-${TABLEAU_PLAN_ALIASES[planId]}`;
  }
  return raw;
}

export function tableauDefinition(value) {
  const featureKey = normalizeTableauFeatureKey(value);
  const planId = normalizeTableauPlanId(value);
  return TABLEAU_DEFINITIONS.find((definition) => (
    definition.featureKey === featureKey || definition.id === planId
  )) || null;
}

export function resolveTableauPlan(payload, featureKeyOrId) {
  if (!payload || typeof payload !== 'object') return null;
  const plans = payload.plans && typeof payload.plans === 'object'
    ? payload.plans
    : payload;
  const raw = String(featureKeyOrId || '')
    .replace(/^tableaux-/, '')
    .trim()
    .toLowerCase();
  const planId = normalizeTableauPlanId(featureKeyOrId);
  return plans?.[planId]
    || plans?.[raw]
    || plans?.[TABLEAU_PLAN_ALIASES[raw]]
    || null;
}

/*
 * Every Tableau loader uses the same date contract. An explicit date comes
 * from Anticipé or the archive and must always win; only a live Tableau
 * request may fall back to the session's current/anticipated date.
 */
export function resolveTableauProgrammeDate(selectedDate, featureKey) {
  const explicit = String(selectedDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const resolved = window.cidEarlyAccessUi?.programmeDateFor?.(featureKey);
  const date = String(resolved || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

/*
 * Never hydrate a card with a normal-day response when a future date was
 * requested. Some legacy functions expose the date under different keys;
 * accept all supported aliases and fail closed when a known date disagrees.
 */
export function assertTableauProgrammeDate(payload, requestedDate, label = 'Tableau') {
  const expected = String(requestedDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) return payload;
  const source = payload?.payload || payload || {};
  const received = String(
    source.date
      || source.programmeDate
      || source.programme_date
      || source.weekDate
      || source.meta?.date
      || source.meta?.programmeDate
      || ''
  ).slice(0, 10);
  if (received && received !== expected) {
    throw new Error(`${label} a retourné ${received} au lieu du ${expected}.`);
  }
  return payload;
}
