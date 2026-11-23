/*
 * Public Supabase configuration boundary.
 *
 * Access rules, plans, balances, prices and payment settings are read from
 * the `subscription-access` Edge Function. The browser never reads the old
 * D1 compatibility endpoint and never keeps a local catalogue. Empty
 * database domains stay empty so the UI can show an administrator-managed
 * state instead of inventing a price or an entitlement.
 */
(function initSiteConfig() {
  'use strict';

  let cache = null;
  let pending = null;
  let cacheEpoch = 0;

  function normalize(list) {
    return Array.isArray(list) ? list : [];
  }

  function requestedLocale() {
    return String(
      window.cidTranslation?.current?.()
        || localStorage.getItem('cid_i18n_locale')
        || navigator.language
        || 'fr'
    ).trim();
  }

  function country(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    return code || 'DEFAULT';
  }

  function specificity(row) {
    let score = 0;
    if (row.target_type === 'category') score -= 1;
    if (row.target_key) score += 2;
    if (row.country_code && row.country_code !== 'DEFAULT' && row.country_code !== '') score += 1;
    return score;
  }

  function publish(nextCache) {
    cache = nextCache;
    window.dispatchEvent(new CustomEvent('cid:site-config-loaded', { detail: { ...cache } }));
    return cache;
  }

  async function requestRemote(requestEpoch = cacheEpoch) {
    if (pending) return pending;
    let request;
    request = (async () => {
      const bridge = await window.cidSupabaseReady;
      if (!bridge?.client?.functions?.invoke) return null;
      const [{ data, error }, platformConfig] = await Promise.all([
        bridge.client.functions.invoke(
          'subscription-access',
          { body: { action: 'state', localeCode: requestedLocale() } }
        ),
        fetch('/api/config/platform', {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null)
      ]);
      if (error || !data?.ok) return null;
      if (requestEpoch !== cacheEpoch) return cache;
      const access = data.access || {};
      const publicConfig = platformConfig?.ok ? platformConfig : {};
      const nextCache = {
        plans: normalize(access.plans),
        plansAll: normalize(access.plans),
        starPrices: normalize(access.starPrices),
        tokenPrices: normalize(access.tokenPrices),
        paymentSettings: access.settings || null,
        localization: access.localization || null,
        localeCode: access.localization?.selectedLocale
          || access.localization?.defaultLocale
          || requestedLocale(),
        // These public presentation domains are served by the existing
        // read-only platform-config route. In particular, the real
        // date/weekday illustration catalogue must also be available to the
        // Anticipé route; an empty object leaves future cards on their
        // structural placeholder instead of the configured image.
        banners: normalize(publicConfig.banners || access.banners),
        grids: publicConfig.grids && typeof publicConfig.grids === 'object'
          ? publicConfig.grids
          : {},
        gridAssignments: normalize(publicConfig.gridAssignments),
        commentRules: {},
        locks: normalize(publicConfig.locks),
        dailyIllustrations: publicConfig.dailyIllustrations
          && typeof publicConfig.dailyIllustrations === 'object'
          ? publicConfig.dailyIllustrations
          : {},
        accessRules: normalize(access.rules),
        earlyAccessRules: normalize(access.earlyAccessRules),
        updatedAt: Date.now()
      };
      return publish(nextCache);
    })().catch(() => null).finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return pending;
  }

  async function load() {
    /*
     * Configuration contains the access catalogue and payment rules. It
     * must follow the same live-read contract as user entitlements; do not
     * serve an old local or in-memory snapshot on a new load.
     */
    return requestRemote();
  }

  function refresh() {
    return load();
  }

  function plans() {
    return cache ? normalize(cache.plans) : [];
  }

  function starPrice(countryCode) {
    const code = country(countryCode);
    const rows = cache ? normalize(cache.starPrices) : [];
    return rows.find((row) => String(row.country_code || '').toUpperCase() === code)
      || rows.find((row) => String(row.country_code || '').toUpperCase() === 'DEFAULT')
      || null;
  }

  function tokenPrice(packId) {
    const id = String(packId || '').trim().toLowerCase();
    const rows = cache ? normalize(cache.tokenPrices) : [];
    return rows.find((row) => String(row.pack_id || '').trim().toLowerCase() === id)
      || null;
  }

  function paymentSettings() {
    return cache ? cache.paymentSettings : null;
  }

  function currencyMode() {
    const mode = String(cache?.paymentSettings?.currency_mode || '').trim().toLowerCase();
    return ['stars', 'tokens', 'both'].includes(mode) ? mode : '';
  }

  function commentRule(key) {
    if (!cache?.commentRules) return null;
    return cache.commentRules[String(key || '').trim()] || null;
  }

  /*
   * État effectif des commentaires pour une publication.
   * La règle la plus précise l'emporte : publication (draw) > catégorie > global.
   * Sans aucune règle, les commentaires sont désactivés. L'administrateur
   * principal doit les activer explicitement pour une surface donnée.
   */
  function commentsEnabled(drawId, type) {
    const rules = cache?.commentRules || {};
    const global = rules.global;
    const draw = drawId ? rules[String(drawId).trim()] : null;
    const category = type ? rules[String(type).trim().toLowerCase()] : null;
    const effective = draw || category || global;
    return effective ? effective.comments_enabled === true : false;
  }

  function locks() {
    return cache ? normalize(cache.locks) : [];
  }

  function lockFor({ type, key, countryCode }) {
    const rows = locks();
    const targetType = String(type || '').trim().toLowerCase();
    const targetKey = String(key || '').trim();
    const country = String(countryCode || '').trim().toUpperCase();
    const matchesType = (row) => row.target_type === targetType || row.target_type === 'category';
    const matchesKey = (row) => !row.target_key || row.target_key === targetKey
      || (row.target_type === 'category' && row.target_key === targetType);
    const matchesCountry = (row) => !row.country_code
      || row.country_code === country
      || row.country_code === 'DEFAULT';
    const active = rows.filter((row) => Number(row.enabled) !== 0 && matchesType(row) && matchesKey(row) && matchesCountry(row));
    if (!active.length) return null;
    // La règle la plus précise (cible précise, pays précis) primerait ;
    // on retourne la première applicable triée par spécificité décroissante.
    return active.sort((a, b) => specificity(b) - specificity(a))[0] || null;
  }

  function banners(placement) {
    const rows = cache ? normalize(cache.banners) : [];
    if (!placement) return rows;
    const key = String(placement).toLowerCase();
    return rows.filter((banner) => String(banner.placement || '').toLowerCase() === key);
  }

  function grid(module) {
    const key = String(module || '').trim();
    if (!cache || !key) return null;
    const row = cache.grids[key];
    if (!row || row.enabled === false) return null;
    return { min: Number(row.min) || 1, max: Number(row.max) || 90 };
  }

  function dailyIllustrations(kind) {
    const key = String(kind || '').trim();
    if (!cache || !key) return [];
    const rows = cache.dailyIllustrations[key];
    return rows ? normalize(rows) : [];
  }

  window.cidSiteConfig = Object.freeze({
    load,
    refresh,
    plans,
    starPrice,
    tokenPrice,
    paymentSettings,
    localization: () => (cache ? cache.localization : null),
    currencyMode,
    commentRule,
    commentsEnabled,
    locks,
    lockFor,
    banners,
    grid,
    gridAssignments: () => (cache ? normalize(cache.gridAssignments) : []),
    dailyIllustrations,
    state: () => (cache ? { ...cache } : null)
  });

  window.addEventListener('cid:admin-config-updated', () => {
    refresh().catch(() => {});
  });
  // The catalogue contains prices and payment settings returned by the same
  // authenticated boundary as subscription access. Do not keep an account-
  // scoped response after a user signs out or another user signs in.
  window.addEventListener('cid:auth-sync', () => {
    cache = null;
    cacheEpoch += 1;
    pending = null;
    refresh().catch(() => {});
  });
  /*
   * The administrator and visitors usually have different browser
   * sessions. Refresh the public catalogue periodically so a change to
   * payment mode, plans, locks or comments propagates without requiring a
   * manual reload. Focus/visibility keep the first return to the site fast.
   */
  // No 30 s polling: the catalogue is re-read at the 16:00 UTC programme
  // boundary and, on return to the app, only when the copy is old.
  const RESUME_REFRESH_AFTER_MS = 15 * 60 * 1000;
  let lastRefreshAt = Date.now();
  window.addEventListener('cid:site-config-loaded', () => { lastRefreshAt = Date.now(); });
  window.addEventListener('cid:programme-boundary', () => refresh().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible'
      && Date.now() - lastRefreshAt > RESUME_REFRESH_AFTER_MS) {
      refresh().catch(() => {});
    }
  });
})();
