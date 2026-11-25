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

  /*
   * Offline entitlement ledger. The last access state confirmed by the
   * server is kept per account in localStorage. It is read only when the
   * browser is offline, so already unlocked programmes can be re-opened from
   * their local copies. Expiry dates are still checked on every read; online,
   * the server answer always wins.
   */
  const OFFLINE_ACCESS_NAME = 'feature-access-offline';
  const VISITOR_IDENTITY = 'visitor';
  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  /*
   * Explicit connection status kept in localStorage:
   *   { status: 'connected' | 'disconnected', userId, email, updatedAt,
   *     plans: [{ slug, name, status, started_at, expires_at }],
   *     unlocks: [{ feature_key, unlocked_at, expires_at }] }
   * 'disconnected' never exposes paid content, even offline. 'connected'
   * lets a returning account (online or not) reopen its tableaux and its
   * nine archived publications from this device at once. The server answer
   * always replaces it as soon as the network is available.
   */
  const SESSION_STATUS_KEY = 'cidmap:session-status:v1';
  function readSessionStatus() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_STATUS_KEY) || 'null');
      return value && (value.status === 'connected' || value.status === 'disconnected')
        ? value
        : null;
    } catch (_) {
      return null;
    }
  }
  function writeSessionStatus(next) {
    try {
      localStorage.setItem(SESSION_STATUS_KEY, JSON.stringify({
        ...next,
        updatedAt: new Date().toISOString()
      }));
    } catch (_) {}
  }
  function markConnected(profile) {
    const userId = String(profile?.id || profile?.uid || '').trim();
    if (!userId) return;
    const previous = readSessionStatus();
    const sameAccount = previous?.userId === userId;
    writeSessionStatus({
      status: 'connected',
      userId,
      email: String(profile?.email || (sameAccount ? previous?.email : '') || ''),
      plans: sameAccount && Array.isArray(previous?.plans) ? previous.plans : [],
      unlocks: sameAccount && Array.isArray(previous?.unlocks) ? previous.unlocks : []
    });
  }
  function markDisconnected() {
    writeSessionStatus({ status: 'disconnected', userId: '', email: '', plans: [], unlocks: [] });
  }
  /* Active, non-expired plans and individual unlocks of the account. */
  function rememberEntitlements(access) {
    const status = readSessionStatus();
    const userId = String(window.cidAuthCurrentUserId || '').trim();
    if (!access || !userId || status?.status !== 'connected' || status.userId !== userId) return;
    const now = Date.now();
    const union = window.cidSubscriptionUnion;
    const plans = union
      ? union.validPlans(access, now).map((entry) => ({
        slug: entry.slug,
        name: String(entry.plan?.display_name || entry.slug),
        status: entry.subscription.status,
        started_at: entry.subscription.started_at || null,
        expires_at: entry.subscription.expires_at || null
      }))
      : [];
    const unlocks = (Array.isArray(access.featureUnlocks) ? access.featureUnlocks : [])
      .filter((unlock) => !unlock?.expires_at || Date.parse(unlock.expires_at) > now)
      .map((unlock) => ({
        feature_key: normalizeFeatureKey(unlock.feature_key || unlock.featureKey),
        unlocked_at: unlock.unlocked_at || null,
        expires_at: unlock.expires_at || null
      }));
    writeSessionStatus({ ...status, plans, unlocks });
  }

  function offlineIdentity() {
    const live = String(window.cidAuthCurrentUserId || '').trim();
    if (live) return live;
    const status = readSessionStatus();
    if (status?.status === 'disconnected') return '';
    return String(
      window.__cidInitialSessionHint?.user?.id
      || (status?.status === 'connected' ? status.userId : '')
      || ''
    ).trim();
  }
  /* Public catalogue only: no balance, plan or unlock of any account. */
  function visitorSnapshot(value) {
    return {
      ...value,
      subscription: null,
      activePlan: null,
      subscriptions: [],
      activePlans: [],
      featureUnlocks: [],
      earlyAccessUnlocks: [],
      earlyAccessGrants: [],
      stars: 0,
      tokens: 0
    };
  }
  function rememberOfflineAccess(value) {
    if (!value) return;
    const identity = offlineIdentity();
    if (!identity) {
      // Free modules stay readable offline for visitors too.
      window.cidPersistentCache?.write?.(OFFLINE_ACCESS_NAME, VISITOR_IDENTITY, visitorSnapshot(value));
      return;
    }
    window.cidPersistentCache?.write?.(OFFLINE_ACCESS_NAME, identity, value);
    rememberEntitlements(value);
  }
  function offlineAccess() {
    const identity = offlineIdentity();
    if (!identity) {
      const visitor = window.cidPersistentCache?.read?.(OFFLINE_ACCESS_NAME, VISITOR_IDENTITY, Infinity);
      return visitor?.value
        ? { ...visitorSnapshot(visitor.value), __offline: true, __complete: false }
        : null;
    }
    const cached = window.cidPersistentCache?.read?.(OFFLINE_ACCESS_NAME, identity, Infinity);
    if (!cached?.value) return null;
    // Every subscription known on this device (multi-abonnements) is merged
    // back, so one stored snapshot never hides another unlock.
    const value = window.cidSubscriptionLedger?.supplementAccess?.(cached.value, identity)
      || cached.value;
    return { ...value, __offline: true, __complete: false };
  }

  /*
   * Local-first paint: the last snapshot confirmed by the server for this
   * account is published immediately (expiry dates are still compared on
   * every read by hasAccess). The live read started right after replaces it.
   */
  function seedFromLedger() {
    const snapshot = offlineAccess();
    if (!snapshot || state) return;
    publish({ ...snapshot, __offline: false, __fromLedger: true });
  }

  let lastLiveLoadAt = 0;

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
      if (isOffline()) return publish(offlineAccess());
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
      if (!accountAccess && isOffline()) return publish(offlineAccess());
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
        // Every active plan of the account (cumulative subscriptions).
        subscriptions: Array.isArray(access.subscriptions) ? access.subscriptions : undefined,
        activePlans: Array.isArray(access.activePlans) ? access.activePlans : undefined,
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
        countryCode: access.countryCode || '',
        // A full live answer lets the ledger drop revoked unlocks.
        __complete: Boolean(accountAccess)
      };
      if (accountAccess) lastLiveLoadAt = Date.now();
      if (accountAccess) rememberOfflineAccess(nextState);
      return publish(nextState);
    })().catch(() => {
      if (requestEpoch !== authEpoch) return state;
      if (isOffline()) return publish(offlineAccess());
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
    // Union of every valid plan (general003 + premium001 + vip002…): each
    // plan only stops counting once its own expires_at has passed.
    const union = window.cidSubscriptionUnion;
    if (union) return union.coveringPlans(access, normalizedFeatureKey).length > 0;
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
    // Offline there is no server to ask: answer at once from the last
    // verified ledger instead of waiting for a network round-trip to fail.
    if (isOffline()) {
      return window.cidIsAdmin === true || hasAccess(state, normalizedFeatureKey);
    }
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
     * Reuse the live answer read less than maxAgeMs ago (default 60 s).
     * Archive syncs call this once per date: without it a nine-day sync
     * re-read the whole access state nine times.
     */
    fresh: (maxAgeMs = 60 * 1000) => (
      state && !state.__offline && !state.__fromLedger
        && Date.now() - lastLiveLoadAt < Math.max(0, Number(maxAgeMs) || 0)
        ? Promise.resolve(state)
        : load()
    ),
    sessionStatus: readSessionStatus,
    /*
     * A successful debit response already contains the authoritative access
     * snapshot. Adopt it immediately instead of allowing an older refresh
     * request to repaint the card as locked again.
     */
    adopt: (nextState) => {
      if (!nextState || typeof nextState !== 'object') return state;
      /*
       * Prolongation / new unlock: the server already returns the new
       * period. It is merged as-is (no client-side date arithmetic) and the
       * subscription ledger stores it under its own key without erasing
       * the account's other subscriptions.
       */
      state = state && typeof state === 'object'
        ? { ...state, ...nextState }
        : { ...nextState };
      state.__complete = false;
      state.__fromLedger = false;
      state.__offline = false;
      rememberOfflineAccess(state);
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
  window.addEventListener('cid:auth-sync', (event) => {
    const profile = event?.detail || null;
    if (String(profile?.id || profile?.uid || '').trim()) markConnected(profile);
    else markDisconnected();
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
  window.addEventListener('online', () => {
    window.cidFeatureAccess.refresh().catch(() => {});
  });
  window.addEventListener('cid:supabase-ready', () => {
    window.cidFeatureAccess.refresh().catch(() => {});
  });
  /*
   * No availability polling. Publications and anticipations only change at
   * the 16:00 UTC generation boundary, so the live state is re-read then.
   * Returning to the app re-reads it only when the last live read is old
   * (administrator revocations still propagate without a 30 s loop).
   */
  const RESUME_REFRESH_AFTER_MS = 15 * 60 * 1000;
  window.addEventListener('cid:programme-boundary', () => {
    window.cidFeatureAccess.refresh().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible'
      && Date.now() - lastLiveLoadAt > RESUME_REFRESH_AFTER_MS) {
      window.cidFeatureAccess.refresh().catch(() => {});
    }
  });

  /*
   * Warm the catalogue after the current script/module batch has registered.
   * This is intentionally deferred so it never competes with the first paint
   * or makes a tap wait on an avoidable startup request.
   */
  seedFromLedger();
  window.setTimeout(() => {
    window.cidFeatureAccess.load().catch(() => {});
  }, 0);
})();
