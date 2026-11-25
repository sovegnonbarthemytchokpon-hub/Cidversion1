/*
 * Cumulative subscriptions.
 *
 * An account may hold several collective plans at the same time
 * (general003, premium001, vip002…). Each plan keeps its own status and its
 * own expires_at; none cancels another. Access is the UNION of:
 *   - every plan that is active, started and not yet expired, and
 *   - every individual unlock (user_feature_unlocks) not yet expired.
 * When one plan expires only its own rights disappear.
 *
 * The server answer may carry `subscriptions` (list, each with its `plan`)
 * or only the legacy `subscription` + `activePlan` pair; both are read.
 * Every module (Tableaux, Anticipé, offers, history…) uses these helpers so
 * one rule applies everywhere.
 */
(function installCidSubscriptionUnion() {
  'use strict';

  const ALIASES = Object.freeze({
    universelle: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby'
  });
  const normalize = (value) => {
    const key = String(value || '').trim().toLowerCase();
    return ALIASES[key] || key;
  };
  const slugOf = (value) => String(value || '').trim().toLowerCase();

  function isRunning(subscription, now = Date.now()) {
    if (!subscription || subscription.status !== 'active') return false;
    if (subscription.started_at) {
      const start = Date.parse(subscription.started_at);
      if (Number.isFinite(start) && start > now) return false;
    }
    if (subscription.expires_at) {
      const end = Date.parse(subscription.expires_at);
      if (!Number.isFinite(end) || end <= now) return false;
    }
    return true;
  }

  function planCovers(plan, featureKey) {
    const wanted = normalize(featureKey);
    const features = (Array.isArray(plan?.features) ? plan.features : []).map(normalize);
    return features.includes(wanted)
      || (wanted.startsWith('tableaux-') && features.includes('tableaux'));
  }

  /* [{ subscription, plan, slug }] — one entry per valid plan, latest
   * expiry first (no expiry = unlimited = first). */
  function validPlans(access, now = Date.now()) {
    if (!access || typeof access !== 'object') return [];
    const catalogue = Array.isArray(access.plans) ? access.plans : [];
    const planFor = (slug, embedded) => {
      const fromCatalogue = catalogue.find((plan) => slugOf(plan?.slug) === slug);
      // A merged legacy activePlan (slugs[]) must not stand for one plan.
      if (embedded && !Array.isArray(embedded.slugs)) return { ...fromCatalogue, ...embedded };
      return fromCatalogue || (embedded && slugOf(embedded.slug) === slug ? embedded : null);
    };
    const candidates = [];
    (Array.isArray(access.subscriptions) ? access.subscriptions : []).forEach((row) => {
      candidates.push({ row, embedded: row?.plan || null });
    });
    if (access.subscription) {
      candidates.push({ row: access.subscription, embedded: access.activePlan || null });
    }
    const bySlug = new Map();
    candidates.forEach(({ row, embedded }) => {
      if (!isRunning(row, now)) return;
      const slug = slugOf(row.plan_slug || row.planSlug || embedded?.slug);
      if (!slug) return;
      let plan = planFor(slug, embedded);
      // Legacy merged activePlan: keep its union of features for the
      // subscription it describes when the catalogue lacks the plan.
      if (!plan && embedded) plan = embedded;
      if (!plan || plan.enabled === false) return;
      const current = bySlug.get(slug);
      const end = row.expires_at ? Date.parse(row.expires_at) : Infinity;
      const currentEnd = current
        ? (current.subscription.expires_at ? Date.parse(current.subscription.expires_at) : Infinity)
        : -Infinity;
      if (!current || end > currentEnd) bySlug.set(slug, { subscription: row, plan, slug });
    });
    return [...bySlug.values()].sort((left, right) => {
      const a = left.subscription.expires_at ? Date.parse(left.subscription.expires_at) : Infinity;
      const b = right.subscription.expires_at ? Date.parse(right.subscription.expires_at) : Infinity;
      return b - a;
    });
  }

  function ruleCovers(access, featureKey, slug) {
    const wanted = normalize(featureKey);
    return (Array.isArray(access?.rules) ? access.rules : []).some((rule) => (
      normalize(rule?.feature_key || rule?.featureKey) === wanted
      && rule?.enabled !== false
      && slugOf(rule?.plan_slug) === slug
    ));
  }

  /* Valid plans that open this feature. */
  function coveringPlans(access, featureKey, now = Date.now()) {
    return validPlans(access, now).filter((entry) => (
      planCovers(entry.plan, featureKey) || ruleCovers(access, featureKey, entry.slug)
    ));
  }

  function activeUnlocks(access, featureKey, now = Date.now()) {
    const wanted = normalize(featureKey);
    return (Array.isArray(access?.featureUnlocks) ? access.featureUnlocks : []).filter((unlock) => (
      normalize(unlock?.feature_key || unlock?.featureKey) === wanted
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > now)
    ));
  }

  /* Latest end date among covering plans and individual unlocks;
   * null when one of them has no end, '' when nothing covers it. */
  function accessEnd(access, featureKey, now = Date.now()) {
    const ends = [];
    for (const entry of coveringPlans(access, featureKey, now)) {
      if (!entry.subscription.expires_at) return null;
      ends.push(entry.subscription.expires_at);
    }
    for (const unlock of activeUnlocks(access, featureKey, now)) {
      if (!unlock.expires_at) return null;
      ends.push(unlock.expires_at);
    }
    return ends.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
  }

  /* Latest-expiring entry of one plan (prolongation start). */
  function planSubscription(access, planSlug, now = Date.now()) {
    const slug = slugOf(planSlug);
    return validPlans(access, now).find((entry) => entry.slug === slug)?.subscription || null;
  }

  const planName = (entry) => String(entry?.plan?.display_name || entry?.slug || '').trim();

  window.cidSubscriptionUnion = Object.freeze({
    normalize,
    isRunning,
    planCovers,
    validPlans,
    coveringPlans,
    activeUnlocks,
    accessEnd,
    planSubscription,
    planNames: (access, featureKey = '') => (
      featureKey ? coveringPlans(access, featureKey) : validPlans(access)
    ).map(planName).filter(Boolean),
    hasAnyPlan: (access) => validPlans(access).length > 0
  });
})();
