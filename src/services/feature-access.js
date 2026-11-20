/*
 * Public feature gate driven by the server-side balance and individual
 * feature grants. Tableaux cards never inherit access from a global plan.
 *
 * The server subscription is the source of truth. Prediction features are
 * protected by default and only an active database entitlement can reveal
 * their values.
 */
(function initCidFeatureAccess() {
  'use strict';

  /*
   * Feature keys are database data. This client only keeps aliases for old
   * links; the active catalogue is always read from Supabase.
   */
  const LEGACY_FEATURE_ALIASES = Object.freeze({
    universelle: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby'
  });
  const normalizeFeatureKey = (value) => {
    const key = String(value || '').trim().toLowerCase();
    return LEGACY_FEATURE_ALIASES[key] || key;
  };
  let state = null;
  let pending = null;
  let pendingEpoch = 0;
  let authEpoch = 0;

  function publish(nextState) {
    state = nextState;
    window.dispatchEvent(new CustomEvent('cid:feature-access-changed', {
      detail: nextState || null
    }));
    return state;
  }

  async function load() {
    /*
     * Entitlements are deliberately not cached in localStorage or reused
     * from a previous in-memory snapshot. A call is a live read; only an
     * already-running request for the same auth epoch may be shared. This
     * prevents an account switch, expiry or revocation from repainting an
     * old Acheter/Actif state.
     */
    if (pending && pendingEpoch === authEpoch) return pending;
    const requestEpoch = authEpoch;
    pending = (async () => {
      // The secure database is the source of truth for the paid catalogue.
      // Force the public configuration boundary to re-read it as well.
      const config = await (window.cidSiteConfig?.refresh?.() || Promise.resolve(null))
        .catch(() => null);
      const configPlans = config ? (Array.isArray(config.plans) ? config.plans : []) : [];
      const configRules = [];
      configPlans
        .filter((plan) => plan.enabled !== false)
        .forEach((plan) => {
          (Array.isArray(plan.features) ? plan.features : []).forEach((feature) => {
            configRules.push({
              feature_key: feature,
              required_stars: Number(plan.required_stars) || 0,
              required_tokens: Number(plan.required_tokens) || 0,
              plan_slug: plan.slug,
              display_name: plan.display_name
            });
          });
        });

      // Overlay the authenticated account (balance, active subscription) when
      // the account service is reachable; otherwise the pure configuration is
      // still enough to lock or reveal the paid sections.
      const bridge = await window.cidSupabaseReady;
      let accountAccess = null;
      if (bridge?.client?.functions?.invoke) {
        try {
          const { data, error } = await bridge.client.functions.invoke('subscription-access', {
            body: {
              action: 'state',
              localeCode: window.cidTranslation?.current?.()
                || localStorage.getItem('cid_i18n_locale')
                || navigator.language
                || 'fr'
            }
          });
          if (!error && data?.ok) accountAccess = data.access || null;
        } catch (_) {
          accountAccess = null;
        }
      }

      const access = accountAccess || {};
      /*
       * Early-access rules describe the public catalogue, not a user's
       * private balance. Some subscription-access responses only include the
       * rules relevant to the current account, which made Anticipé show
       * different future dates after switching users. Start with the public
       * catalogue and let an account response override the same feature key.
       */
      const publicEarlyAccessRules = Array.isArray(config?.earlyAccessRules)
        ? config.earlyAccessRules
        : [];
      const accountEarlyAccessRules = Array.isArray(access.earlyAccessRules)
        ? access.earlyAccessRules
        : [];
      const earlyAccessRulesByKey = new Map();
      [...publicEarlyAccessRules, ...accountEarlyAccessRules].forEach((rule) => {
        const key = normalizeFeatureKey(rule?.feature_key || rule?.featureKey);
        if (key) earlyAccessRulesByKey.set(key, { ...rule, feature_key: key });
      });
      // A response started for the previous account must never repaint the
      // newly selected account after logout/login.
      if (requestEpoch !== authEpoch) return state;
      const nextState = {
        plans: Array.isArray(access.plans) && access.plans.length ? access.plans : configPlans,
        rules: Array.isArray(access.rules) && access.rules.length ? access.rules : configRules,
        settings: access.settings || config?.paymentSettings || null,
        localization: access.localization || config?.localization || null,
        localeCode: access.localization?.selectedLocale
          || config?.localeCode
          || window.cidTranslation?.current?.()
          || 'fr',
        starPrices: Array.isArray(access.starPrices) && access.starPrices.length
          ? access.starPrices
          : (Array.isArray(config?.starPrices) ? config.starPrices : []),
        tokenPrices: Array.isArray(access.tokenPrices) && access.tokenPrices.length
          ? access.tokenPrices
          : (Array.isArray(config?.tokenPrices) ? config.tokenPrices : []),
        gridAssignments: Array.isArray(config?.gridAssignments) ? config.gridAssignments : [],
        subscription: access.subscription || null,
        activePlan: access.activePlan || null,
        featureUnlocks: Array.isArray(access.featureUnlocks)
          ? access.featureUnlocks
          : [],
        earlyAccessRules: Array.from(earlyAccessRulesByKey.values()),
        earlyAccessUnlocks: Array.isArray(access.earlyAccessUnlocks)
          ? access.earlyAccessUnlocks
          : [],
        earlyAccessGrants: Array.isArray(access.earlyAccessGrants)
          ? access.earlyAccessGrants
          : [],
        stars: Number(access.stars) || 0,
        tokens: Number(access.tokens) || 0,
        countryCode: access.countryCode || ''
      };
      return publish(nextState);
    })().catch(() => {
      if (requestEpoch !== authEpoch) return state;
      // Fail closed. A transient database error must not leave a previous
      // account's entitlement visible as an active purchase state.
      return publish(null);
    }).finally(() => {
      if (pendingEpoch === requestEpoch) pending = null;
    });
    pendingEpoch = requestEpoch;
    return pending;
  }

  function activeSubscription(access) {
    const subscription = access?.subscription;
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.started_at
      && Date.parse(subscription.started_at) > Date.now()) return null;
    if (subscription.expires_at) {
      const expiresAt = Date.parse(subscription.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return subscription;
  }

  function planIncludesFeature(plan, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    const features = Array.isArray(plan?.features) ? plan.features : [];
    const normalizedFeatures = features.map(normalizeFeatureKey);
    return normalizedFeatures.includes(normalizedFeatureKey)
      || (
        normalizedFeatureKey.startsWith('tableaux-')
        && normalizedFeatures.includes('tableaux')
      );
  }

  function ruleFor(access, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    return (access?.rules || []).find((item) => (
      normalizeFeatureKey(item?.feature_key || item?.featureKey) === normalizedFeatureKey
    )) || null;
  }

  function activeGrantFor(access, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    return (access?.featureUnlocks || []).find((unlock) => (
      normalizeFeatureKey(unlock?.feature_key || unlock?.featureKey) === normalizedFeatureKey
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
    )) || null;
  }

  function hasAccess(access, featureKey) {
    if (window.cidIsAdmin === true) return true;
    if (!access) return false;
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    const rule = ruleFor(access, normalizedFeatureKey);
    if (activeGrantFor(access, normalizedFeatureKey)) return true;
    const plans = Array.isArray(access.plans) ? access.plans : [];
    const isConfiguredInAnOffer = plans.some((plan) => (
      planIncludesFeature(plan, normalizedFeatureKey)
    ));
    // An unconfigured key remains public. Once an administrator creates a
    // rule or assigns the key to a plan, the database is authoritative.
    if (!rule && !isConfiguredInAnOffer) return true;
    if (rule && !rule.plan_slug
      && Number(rule.required_stars || 0) === 0
      && Number(rule.required_tokens || 0) === 0
      && !isConfiguredInAnOffer) return true;
    const subscription = activeSubscription(access);
    if (!subscription) return false;
    const plan = access.activePlan;
    if (plan?.slug && rule?.plan_slug && plan.slug === rule.plan_slug) return true;
    return planIncludesFeature(plan, normalizedFeatureKey);
  }

  async function requireAccess(featureKey, options = {}) {
    /*
     * Navigation must not wait for a fresh network round-trip every time a
     * visitor taps a section. The catalogue is warmed in the background and
     * refreshed on focus/visibility changes. Reusing the current snapshot
     * keeps the first tap synchronous once that warm-up has completed while
     * preserving the same server-backed entitlement decision.
     */
    const access = await load();
    if (hasAccess(access, featureKey)) return true;
    const isCurrent = typeof options?.isCurrent === 'function'
      ? options.isCurrent
      : () => true;
    if (!isCurrent()) return false;
    // Keep rejected navigation on the existing account/auth surface. The
    // former dedicated offers page rendered a misleading zero-balance state
    // before the account service had finished loading.
    window.setTimeout(() => {
      if (!isCurrent()) return;
      window.showProfileView?.();
      window.setTimeout(() => window.cidSetAccountTab?.('rewards', { immediate: true }), 100);
    }, 0);
    return false;
  }

  /*
   * Server-side preflight for protected Tableaux payloads.
   *
   * The entitlement snapshot is useful for painting the shell, but a
   * protected programme request must also be backed by the database function
   * user_can_access_tableau(). This second check prevents a stale browser
   * snapshot from authorising a remote loader after a grant has expired or
   * been revoked.
   */
  async function verifyTableauxAccess(featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    if (!normalizedFeatureKey.startsWith('tableaux-')) return false;
    try {
      const bridge = await window.cidSupabaseReady;
      const client = bridge?.client;
      if (!client?.rpc) {
        return window.cidIsAdmin === true
          || hasAccess(state, normalizedFeatureKey);
      }
      const { data, error } = await client.rpc('user_can_access_tableau', {
        target_feature_key: normalizedFeatureKey
      });
      /*
       * The Edge Functions remain the final authority and fail closed. This
       * browser preflight may fall back to the already verified entitlement
       * snapshot so Safari/network hiccups do not hide valid content before
       * the protected function has a chance to answer.
       */
      if (error) {
        return window.cidIsAdmin === true
          || hasAccess(state, normalizedFeatureKey);
      }
      return data === true || data?.access === true || data?.allowed === true;
    } catch (_) {
      return window.cidIsAdmin === true
        || hasAccess(state, normalizedFeatureKey);
    }
  }

  window.cidFeatureAccess = Object.freeze({
    load,
    preload: () => load(),
    refresh: () => load(),
    /*
     * A successful debit response already contains the authoritative access
     * snapshot. Adopt it immediately instead of allowing an older refresh
     * request to repaint the card as locked again.
     */
    adopt: (nextState) => {
      if (!nextState || typeof nextState !== 'object') return state;
      state = state && typeof state === 'object'
        ? { ...state, ...nextState }
        : nextState;
      window.dispatchEvent(new CustomEvent('cid:feature-access-changed', {
        detail: state
      }));
      return state;
    },
    state: () => state,
    has: (featureKey) => hasAccess(state, featureKey),
    verifyTableauxAccess,
    require: requireAccess,
    reset: () => {
      state = null;
      pending = null;
      window.dispatchEvent(new CustomEvent('cid:feature-access-changed', { detail: null }));
    },
    protectedFeatures: Object.freeze([])
  });
  window.addEventListener('cid:auth-sync', () => {
    authEpoch += 1;
    state = null;
    // Do not wait for the old request to finish before locking the cards.
    // Its result is ignored by the epoch check above.
    window.dispatchEvent(new CustomEvent('cid:feature-access-changed', { detail: null }));
    window.cidFeatureAccess.load().catch(() => {});
  });

  /*
   * The administrator and the visitor may be looking at different sections
   * of this single-page app. Refresh the catalogue when the app comes back
   * into view so deleting or disabling an offer is reflected without a full
   * browser reload.
   */
  window.addEventListener('cid:admin-access-updated', () => {
    window.cidFeatureAccess.refresh().catch(() => {});
  });
  window.addEventListener('focus', () => {
    window.cidFeatureAccess.refresh().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.cidFeatureAccess.refresh().catch(() => {});
    }
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      window.cidFeatureAccess.refresh().catch(() => {});
    }
  }, 30000);

  /*
   * Warm the catalogue after the current script/module batch has registered.
   * This is intentionally deferred so it never competes with the first paint
   * or makes a tap wait on an avoidable startup request.
   */
  window.setTimeout(() => {
    window.cidFeatureAccess.load().catch(() => {});
  }, 0);
})();
