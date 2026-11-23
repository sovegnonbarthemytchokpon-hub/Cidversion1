/*
 * Dedicated Anticipé route.
 *
 * The catalogue is database-driven: only active Supabase early-access rules
 * become cards. A locked card never requests its future payload. Once the
 * database confirms the grant, the real publication is rendered through the
 * same social post mould used by Accueil.
 */

import { fetchRejectedBalls } from '/src/backend-server/methods/boulesRejeteesMethod.js';
import {
  applyCrossDayStyle,
  crossDayStyleForDate,
  fetchCroixProgrammeForDate
} from '/src/croix/redCrossService.js';
import {
  TABLEAU_DEFINITIONS,
  normalizeTableauFeatureKey,
  normalizeTableauPlanId,
  resolveTableauPlan
} from '/src/tableaux/tableau-contract.js';
import { SECURE_DISPLAY } from '/src/shared/affichageSecurise.js';

(() => {
  'use strict';

  const VIEW_ID = 'anticipationViewContainer';
  const MOUNT_ID = 'anticipationViewMount';
  const FEATURE_LABELS = Object.freeze({
    matrice: 'Matrice',
    'boules-rejetees': 'Boules rejetées',
    croix: 'Croix nationale',
    'tableaux-universelle': 'Universelle',
    'tableaux-intuition': 'Intuition',
    'tableaux-oracle': 'Oracle',
    'tableaux-lnb': 'LNB',
    'tableaux-balsa': 'Balsa Plus',
    'tableaux-standby': 'Stand-by',
    'tableaux-robot': 'Robot',
    'tableaux-created': 'Programmes personnalisés'
  });

  let renderToken = 0;
  let renderInFlight = null;
  const payloadCache = new Map();
  let tableauxPreviewReadyPromise = null;
  let anticipationRefreshTimer = null;
  let priorityPublication = null;
  // Account whose cards are currently mounted (never reuse another one's).
  let lastRenderIdentity = '';
  /*
   * A subscriber can reveal a future publication from Anticipé without
   * buying a second, date-specific anticipation grant. Keep that choice
   * local to the current page session so a refresh/auth change never turns
   * it into a persistent entitlement.
   */
  const directAnticipationReveals = new Set();
  const get = (id) => document.getElementById(id);
  const clean = (value, fallback = '') => String(value ?? '').trim() || fallback;
  const callGlobal = (name, ...args) => {
    const fn = window?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  };
  const callGlobalMethod = (ownerName, methodName, ...args) => {
    const owner = window?.[ownerName];
    const method = owner?.[methodName];
    return typeof method === 'function'
      ? method.apply(owner, args)
      : undefined;
  };
  const t = (key, fallback = key) => (
    callGlobalMethod('cidTranslation', 't', key, fallback) || fallback
  );
  const ti = (key, values = {}, fallback = key) => (
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
      t(key, fallback)
    )
  );
  const keyOf = (rule) => clean(rule?.feature_key || rule?.featureKey).toLowerCase();
  /*
   * Publication renderer for a rule key. The administrator can publish the
   * anticipated Boules rejetées (or Matrice / Croix) under the history key
   * (`historique-rejetees`, ...). That key fell through every branch, so the
   * card had no coloured banner and "Voir plus" could not open the grids.
   * Only the DISPLAY is aliased: grants, unlock requests and server checks
   * keep the exact key configured by the administrator.
   */
  const CONTENT_KEY_ALIASES = Object.freeze({
    'historique-rejetees': 'boules-rejetees',
    'historique-matrice': 'matrice',
    'historique-croix': 'croix'
  });
  const contentKeyOf = (key) => {
    const value = clean(key).toLowerCase();
    return CONTENT_KEY_ALIASES[value] || value;
  };
  const currentIdentity = () => (
    String(window.cidAuthCurrentUserId || 'visitor').trim() || 'visitor'
  );
  const TABLEAU_PORTFOLIO_SELECTORS = Object.freeze(Object.fromEntries(
    TABLEAU_DEFINITIONS.map(({ featureKey, portfolioClass }) => (
      [featureKey, `.${portfolioClass}`]
    ))
  ));
  const PREVIEW_KEY_ZERO = SECURE_DISPLAY.format('key');
  const PREVIEW_VALUE_ZERO = SECURE_DISPLAY.format('table');
  const PREVIEW_CROSS_ZERO = SECURE_DISPLAY.cross;
  const previewValue = (value, fallback = PREVIEW_VALUE_ZERO) => (
    value === undefined || value === null || String(value).trim() === ''
      ? fallback
      : String(value)
  );
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function zeroExistingDigits(value) {
    const text = String(value ?? '').trim();
    if (!text) return '0';
    /*
     * Tableaux' secure display uses bullet characters for locked values.
     * Anticipé has a deliberately readable zero preview, so convert both
     * existing digits and those secure markers instead of leaving `••`.
     */
    const normalized = text
      .replace(/\d/g, '0')
      .replace(/[•·…]/g, '0')
      .replace(/[—–-]/g, '0');
    return normalized || '0';
  }

  function maskExistingDigits(root, selector) {
    root?.querySelectorAll(selector).forEach((element) => {
      element.textContent = zeroExistingDigits(element.textContent);
    });
  }

  function previewDates(rule) {
    const key = keyOf(rule);
    const configured = callGlobalMethod(
      'cidEarlyAccessUi',
      'previewProgrammeDates',
      key
    );
    if (Array.isArray(configured) && configured.length) {
      return configured.map((date) => String(date).slice(0, 10));
    }
    const configuredDate = callGlobalMethod(
      'cidEarlyAccessUi',
      'previewProgrammeDate'
    );
    return configuredDate ? [String(configuredDate).slice(0, 10)] : [];
  }

  function savedDates(access, rule) {
    const key = keyOf(rule);
    return (Array.isArray(access?.earlyAccessUnlocks)
      ? access.earlyAccessUnlocks
      : [])
      .filter((item) => keyOf(item) === key)
      .map((item) => String(item?.programme_date || '').slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  }

  function datesForRule(access, rule) {
    const normalDate = normalProgrammeDate();
    const canonicalNextDate = normalDate
      ? addIsoDays(normalDate, 1)
      : '';
    const dates = [...new Set([
      ...previewDates(rule),
      ...savedDates(access, rule),
      // Every enabled anticipation rule has one stable next-programme card.
      // This keeps the catalogue identical across accounts even when an
      // account-scoped access response omits its preview date rows.
      canonicalNextDate
    ])];

    /*
     * The access snapshot intentionally keeps a short history of unlocks so
     * the account area can display it. The Anticipé route is different: it
     * must only show publications that are still ahead of the current normal
     * programme. Without this boundary, an unlock from (for example) Monday
     * remains visible for several days and can be mistaken for today's
     * anticipation.
     */
    return dates
      .filter((date) => !normalDate || date > normalDate)
      .sort((left, right) => right.localeCompare(left));
  }

  function dateObject(value) {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function dateLabel(value) {
    return dateObject(value).toLocaleDateString(
      callGlobalMethod('cidTranslation', 'current') || 'fr',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Abidjan'
      }
    );
  }

  function normalProgrammeDate() {
    const configured = isoDate(
      callGlobalMethod('cidEarlyAccessUi', 'programmeDate')
    );
    if (configured) return configured;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Abidjan',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
    const part = (type) => Number(
      parts.find((entry) => entry.type === type)?.value
    );
    const date = new Date(Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + (part('hour') >= 16 ? 1 : 0),
      12
    ));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function isoDate(value) {
    const date = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  }

  function addIsoDays(value, days) {
    const date = new Date(`${isoDate(value)}T12:00:00.000Z`);
    if (!isoDate(value) || Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days) || 0));
    return date.toISOString().slice(0, 10);
  }

  function earlyAccessRule(access, key, fallback = null) {
    return (access?.earlyAccessRules || []).find((item) => (
      keyOf(item) === key
    )) || fallback;
  }

  function earlyAccessGrant(access, key) {
    return (Array.isArray(access?.earlyAccessGrants)
      ? access.earlyAccessGrants
      : [])
      .filter((grant) => (
        keyOf(grant) === key
        && Number(grant?.days) > 0
        && (!grant?.expires_at || Date.parse(grant.expires_at) > Date.now())
      ))
      .sort((left, right) => Number(right.days) - Number(left.days))[0] || null;
  }

  function earlyAccessUnlockActive(item, rule) {
    const explicit = String(item?.expires_at || '').trim();
    if (explicit) {
      const expiry = Date.parse(explicit);
      return Number.isFinite(expiry) && expiry > Date.now();
    }
    const unlockedAt = Date.parse(String(item?.unlocked_at || ''));
    return Number.isFinite(unlockedAt)
      && unlockedAt + Math.max(1, Number(rule?.duration_days) || 30) * 86400000 > Date.now();
  }

  function earlyAccessDays(access, key, normalDate) {
    const rollingDays = Number(earlyAccessGrant(access, key)?.days) || 0;
    if (rollingDays > 0) return rollingDays;

    /*
     * Keep legacy date rows working while installations migrate to the
     * rolling grant table. Count only the contiguous future window.
     */
    const dates = new Set(
      (Array.isArray(access?.earlyAccessUnlocks)
        ? access.earlyAccessUnlocks
        : [])
        .filter((item) => (
          keyOf(item) === key
          && earlyAccessUnlockActive(item, earlyAccessRule(access, key))
        ))
        .map((item) => isoDate(item?.programme_date))
        .filter(Boolean)
    );
    let days = 0;
    for (let offset = 1; dates.has(addIsoDays(normalDate, offset)); offset += 1) {
      days += 1;
    }
    return days;
  }

  function earlyAccessExpiry(access, key, rule) {
    const entries = [
      ...(Array.isArray(access?.earlyAccessGrants)
        ? access.earlyAccessGrants
        : []),
      ...(Array.isArray(access?.earlyAccessUnlocks)
        ? access.earlyAccessUnlocks
        : [])
    ].filter((item) => (
      keyOf(item) === key
      && earlyAccessUnlockActive(item, rule)
    ));
    if (!entries.length) return '';

    const expiries = [];
    for (const item of entries) {
      const explicit = Date.parse(String(item?.expires_at || ''));
      if (Number.isFinite(explicit)) {
        if (explicit > Date.now()) expiries.push(explicit);
        continue;
      }
      const unlockedAt = Date.parse(String(item?.unlocked_at || ''));
      if (!Number.isFinite(unlockedAt)) return '';
      expiries.push(
        unlockedAt
        + Math.max(1, Number(rule?.duration_days) || 30) * 86400000
      );
    }
    if (!expiries.length) return '';
    return new Date(Math.max(...expiries)).toISOString();
  }

  function anticipationMetaMarkup({
    access,
    key,
    rule,
    normalDate,
    currentDays = 0,
    selectedDays = 0
  }) {
    const durationDays = Math.max(1, Number(rule?.duration_days) || 30);
    const coverageDays = Math.max(currentDays, selectedDays);
    const coverageDate = coverageDays > 0
      ? addIsoDays(normalDate, coverageDays)
      : '';
    const expiry = earlyAccessExpiry(access, key, rule);
    const parts = [
      `Validité du droit : ${durationDays} jour${durationDays > 1 ? 's' : ''}`
    ];
    if (coverageDate) {
      parts.push(`fenêtre couverte jusqu’au ${dateLabel(coverageDate)}`);
    }
    if (expiry) {
      parts.push(`votre anticipation expire le ${dateLabel(expiry)}`);
    }
    return `<span class="anticipation-access-meta">${escapeHtml(parts.join(' · '))}</span>`;
  }

  function labelFor(rule) {
    const key = keyOf(rule);
    const configured = clean(rule?.display_name || rule?.displayName);
    return configured && configured.toLowerCase() !== key
      ? configured
      : (FEATURE_LABELS[key] || configured || key);
  }

  function rollingGrantCovers(access, key, date) {
    const normal = callGlobalMethod('cidEarlyAccessUi', 'programmeDate');
    if (!normal) return false;
    const requested = new Date(`${date}T12:00:00.000Z`);
    const normalDate = new Date(`${normal}T12:00:00.000Z`);
    if (Number.isNaN(requested.getTime()) || Number.isNaN(normalDate.getTime())) {
      return false;
    }
    const offset = Math.floor(
      (requested.getTime() - normalDate.getTime()) / 86400000
    );
    return Boolean(access?.earlyAccessGrants?.some((grant) => (
      clean(grant?.feature_key || grant?.featureKey).toLowerCase() === key
      && offset > 0
      && Number(grant?.days) >= offset
      && (!grant?.expires_at || Date.parse(grant.expires_at) > Date.now())
    )));
  }

  function planCoversFeature(plan, key) {
    const normalizedKey = String(key || '').toLowerCase();
    const features = Array.isArray(plan?.features)
      ? plan.features.map((feature) => (
        typeof feature === 'object'
          ? clean(feature?.feature_key || feature?.featureKey || feature?.key).toLowerCase()
          : String(feature || '').toLowerCase()
      ))
      : [];
    return features.includes(normalizedKey) || (
      normalizedKey.startsWith('tableaux-')
      && features.includes('tableaux')
    );
  }

  function requiresBaseFeatureAccess(access, key, rule) {
    if (window.cidIsAdmin === true) return false;
    const configuredRule = (access?.rules || []).find((item) => keyOf(item) === key)
      || null;
    if (
      configuredRule?.plan_slug
      || Number(configuredRule?.required_stars) > 0
      || Number(configuredRule?.required_tokens) > 0
    ) {
      return true;
    }
    return (Array.isArray(access?.plans) ? access.plans : []).some((plan) => (
      plan?.enabled !== false
      && planCoversFeature(plan, key)
      && (
        plan?.unlock_currency === 'stars'
          ? Number(plan?.required_stars) > 0
          : Number(plan?.required_tokens ?? plan?.regular_tokens) > 0
      )
    ));
  }

  function hasBaseFeatureAccess(access, key, rule) {
    if (!requiresBaseFeatureAccess(access, key, rule)) return true;
    return callGlobalMethod('cidFeatureAccess', 'has', key) === true;
  }

  function activeIndividualFeatureGrant(access, key) {
    return Boolean((access?.featureUnlocks || []).some((unlock) => (
      keyOf(unlock) === key
      && (!unlock?.expires_at || Date.parse(unlock.expires_at) > Date.now())
    )));
  }

  function activeSubscription(access) {
    const subscription = access?.subscription;
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.started_at && Date.parse(subscription.started_at) > Date.now()) {
      return null;
    }
    if (subscription.expires_at) {
      const expiresAt = Date.parse(subscription.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return subscription;
  }

  function directAnticipationAccess(access, key) {
    if (window.cidIsAdmin === true) {
      return {
        hasAccess: true,
        individualActive: false,
        collectiveActive: false,
        planName: 'Administrateur'
      };
    }

    /*
     * Tableaux already owns the most detailed interpretation of individual
     * grants versus collective plans. Reuse it when the dedicated view has
     * registered its classifier; the generic fallback keeps Matrice, Croix
     * and Boules compatible with the same access snapshot.
     */
    const tableauxSource = key.startsWith('tableaux-')
      ? callGlobal('cidTableauxAccessSource', access, key)
      : null;
    if (tableauxSource) {
      return {
        hasAccess: Boolean(
          tableauxSource.individualActive || tableauxSource.collectiveActive
        ),
        individualActive: Boolean(tableauxSource.individualActive),
        collectiveActive: Boolean(tableauxSource.collectiveActive),
        planName: tableauxSource.planName || ''
      };
    }

    const individualActive = activeIndividualFeatureGrant(access, key);
    const subscription = activeSubscription(access);
    const activePlan = access?.activePlan;
    const collectiveActive = Boolean(
      subscription
      && (
        planCoversFeature(activePlan, key)
        || (access?.rules || []).some((rule) => (
          keyOf(rule) === key
          && String(rule?.plan_slug || '') === String(activePlan?.slug || '')
        ))
      )
    );
    return {
      hasAccess: individualActive || collectiveActive,
      individualActive,
      collectiveActive,
      planName: activePlan?.display_name || activePlan?.slug || ''
    };
  }

  function directRevealKey(key, date) {
    /*
     * Keep the reveal decision account-scoped even if an auth provider does
     * not emit its session event before the next click.  The server remains
     * authoritative, but this prevents the previous account's in-memory
     * reveal flag from changing the next account's UI.
     */
    return `${currentIdentity()}:${key}:${String(date || '').slice(0, 10)}`;
  }

  function anticipationAccessControl({ access, key, rule, date, packageDates }) {
    const wrap = document.createElement('div');
    wrap.className = 'anticipation-access-required anticipation-access-ready';
    wrap.innerHTML = `
      <strong>Vous pouvez anticiper</strong>
      <span>${escapeHtml(
        directAnticipationAccess(access, key).planName
          ? `Votre accès (${directAnticipationAccess(access, key).planName}) inclut cette publication.`
          : 'Votre accès actif inclut cette publication.'
      )}</span>
      <div class="anticipation-access-actions">
        <button type="button" class="anticipation-access-button anticipation-access-button--primary"
                data-anticipation-reveal>
          Afficher la publication future
        </button>
      </div>`;
    const button = wrap.querySelector('[data-anticipation-reveal]');
    button?.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        /*
         * The initial card may have been painted from a warm snapshot. A
         * final refresh at the moment of the action prevents an expired or
         * revoked subscription from revealing a future payload.
         */
        const liveAccess = await Promise.resolve(
          callGlobalMethod('cidFeatureAccess', 'refresh')
        ).catch(() => null);
        const checkedAccess = liveAccess && typeof liveAccess === 'object'
          ? liveAccess
          : access;
        if (!directAnticipationAccess(checkedAccess, key).hasAccess) {
          directAnticipationReveals.delete(directRevealKey(key, date));
          await render({ preserveView: true });
          return;
        }
        directAnticipationReveals.add(directRevealKey(key, date));
        priorityPublication = { key, date: String(date || '').slice(0, 10) };
        payloadCache.delete(`${currentIdentity()}:${key}:${date}`);
        await render({ preserveView: true });
        focusPriorityPublication();
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
    wrap.dataset.anticipationFeature = key;
    wrap.dataset.anticipationPublicationDate = String(date || '').slice(0, 10);
    wrap.dataset.anticipationPackageDates = String(packageDates?.length || 0);
    return wrap;
  }

  function baseAccessControl(access, key, rule) {
    const wrap = document.createElement('div');
    wrap.className = 'anticipation-access-required';
    wrap.innerHTML = `
      <strong>Accès requis avant l’anticipation</strong>
      <span>Veuillez d’abord acheter ${escapeHtml(labelFor(rule))} individuellement ou choisir un abonnement collectif.</span>
      <div class="anticipation-access-actions">
        <button type="button" class="anticipation-access-button" data-anticipation-individual>
          Acheter cette clé
        </button>
        <button type="button" class="anticipation-access-button anticipation-access-button--collective" data-anticipation-collective>
          Faire un abonnement collectif
        </button>
      </div>`;
    const individualButton = wrap.querySelector('[data-anticipation-individual]');
    individualButton?.addEventListener('click', async () => {
      if (individualButton.disabled) return;
      individualButton.disabled = true;
      individualButton.setAttribute('aria-busy', 'true');
      try {
        /*
         * A Tableau purchase belongs to the dedicated Tableau catalogue.
         * Do not debit through the generic feature-unlock action here: it
         * skips the individual catalogue and can show the wrong offer.
         */
        if (key.startsWith('tableaux-')
          && typeof window.showTableauxView === 'function') {
          await window.showTableauxView({
            catalogueMode: 'individual',
            activeFeature: key
          });
          return;
        }
        const liveAccess = await Promise.resolve(
          callGlobalMethod('cidFeatureAccess', 'refresh')
        ).catch(() => null);
        const featureRule = (liveAccess?.rules || []).find((item) => (
          keyOf(item) === key
        )) || null;
        const result = await callGlobal('cidUnlockFeature', key, {
          label: labelFor(rule),
          requiredStars: Number(featureRule?.required_stars) || 0,
          requiredTokens: Number(featureRule?.required_tokens) || 0
        });
        if (!result?.ok && !result?.requiresAuth && !result?.insufficientBalance) {
          window.alert(result?.error || 'Achat individuel impossible.');
        }
        if (result?.ok) {
          await render({ preserveView: true });
        }
      } finally {
        individualButton.disabled = false;
        individualButton.removeAttribute('aria-busy');
      }
    });
    wrap.querySelector('[data-anticipation-collective]')?.addEventListener('click', () => {
      if (typeof window.showOffersView === 'function') {
        window.showOffersView();
        return;
      }
      callGlobal('showProfileView');
      window.setTimeout(() => {
        callGlobal('cidSetAccountTab', 'rewards', { immediate: true });
      }, 100);
    });
    wrap.dataset.anticipationFeature = key;
    return wrap;
  }

  function isUnlocked(access, key, date, rule) {
    if (window.cidIsAdmin === true) return true;
    const sharedDecision = callGlobalMethod(
      'cidEarlyAccessUi',
      'isUnlocked',
      access,
      key,
      date,
      rule
    );
    if (sharedDecision === true) return true;
    return rollingGrantCovers(access, key, date)
      || Boolean(access?.earlyAccessUnlocks?.some((item) => (
      clean(item?.feature_key || item?.featureKey).toLowerCase() === key
      && String(item?.programme_date || '').slice(0, 10) === date
      && earlyAccessUnlockActive(item, rule)
    )));
  }

  function tokenIcon() {
    return '<span class="cid-token-icon" aria-hidden="true"></span>';
  }

  function purchaseMeta(amount) {
    const value = Math.max(0, Number(amount) || 0);
    return value > 0
      ? `<span class="cid-purchase-cost" aria-label="${escapeHtml(ti('anticipation.cost', { value }, `Coût ${value}`))}">${tokenIcon()}<b>${value}</b></span>`
      : `<span class="cid-purchase-cost" data-free="true">${escapeHtml(t('anticipation.free', 'Accès libre'))}</span>`;
  }

  function tokenCost(rule, days) {
    // An active anticipation is always a paid add-on. Older configurations
    // could expose a zero cost, which made the confirmation succeed silently
    // without changing the user's balance.
    const one = Math.max(1, Number(
      rule?.token_cost_1_day ?? rule?.required_tokens
    ) || 1);
    const two = Math.max(2, Number(rule?.token_cost_2_days ?? (one * 2)) || (one * 2));
    const three = Math.max(3, Number(rule?.token_cost_3_days ?? (one * 3)) || (one * 3));
    return days === 3 ? three : days === 2 ? two : one;
  }

  function entitlementEndDate(access, key) {
    const rule = (access?.rules || []).find((item) => (
      keyOf(item) === key
    ));
    const plans = Array.isArray(access?.plans) ? access.plans : [];
    const configuredInOffer = plans.some((plan) => (
      Array.isArray(plan?.features)
      && (plan.features.includes(key) || plan.features.includes('tableaux'))
    ));
    if (!rule && !configuredInOffer) return null;

    const dates = [];
    const grant = (access?.featureUnlocks || []).find((item) => (
      String(item?.feature_key || '').toLowerCase() === key
      && (!item?.expires_at || Date.parse(item.expires_at) > Date.now())
    ));
    if (grant) {
      if (!grant.expires_at) return null;
      dates.push(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Abidjan'
      }).format(new Date(grant.expires_at)));
    }
    const subscription = access?.subscription;
    const planFeatures = Array.isArray(access?.activePlan?.features)
      ? access.activePlan.features
      : [];
    if (subscription?.status === 'active'
        && (
          planFeatures.includes(key)
          || planFeatures.includes('tableaux')
          || (
            rule?.plan_slug
            && rule.plan_slug === access?.activePlan?.slug
          )
        )) {
      if (!subscription.expires_at) return null;
      dates.push(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Abidjan'
      }).format(new Date(subscription.expires_at)));
    }
    return dates.filter(Boolean).sort().at(-1) || '';
  }

  function packageDaysForAccess(access, key, startDate, maxDays) {
    const endDate = entitlementEndDate(access, key);
    if (!endDate) return maxDays;
    let available = 0;
    for (let offset = 0; offset < maxDays; offset += 1) {
      const date = new Date(`${startDate}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      if (date.toISOString().slice(0, 10) > endDate) break;
      available += 1;
    }
    return available;
  }

  function packageControl(
    rule,
    date,
    maxDays,
    onPurchase,
    {
      access = null,
      key = '',
      normalDate = '',
      currentDays = 0
    } = {}
  ) {
    const days = Math.max(1, Math.min(3, Number(maxDays) || 1));
    const firstOption = Math.max(
      1,
      Math.min(days, Number(currentDays) + 1)
    );
    const isExtension = Number(currentDays) > 0;
    const wrap = document.createElement('div');
    wrap.className = 'anticipation-purchase';
    const picker = document.createElement('select');
    picker.className = 'anticipation-days-picker';
    picker.setAttribute('aria-label', t('anticipation.daysLabel', 'Nombre de jours à anticiper'));
    for (let value = firstOption; value <= days; value += 1) {
      const option = document.createElement('option');
      option.value = String(value);
      const optionCost = Math.max(
        0,
        tokenCost(rule, value) - tokenCost(rule, currentDays)
      );
      option.textContent = ti(
        'anticipation.dayOption',
        { days: value, tokens: optionCost },
        `${value} jour${value > 1 ? 's' : ''} · ${optionCost} jeton(s)`
      );
      picker.appendChild(option);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cid-buy-button anticipation-unlock-button';
    const feedback = document.createElement('span');
    feedback.className = 'anticipation-action-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const meta = document.createElement('span');
    meta.className = 'anticipation-access-meta';
    const refreshCost = () => {
      const selectedDays = Number(picker.value) || 1;
      const amount = Math.max(
        0,
        tokenCost(rule, selectedDays) - tokenCost(rule, currentDays)
      );
      const actionLabel = isExtension ? 'prolonger' : 'anticiper';
      button.innerHTML = `${tokenIcon()}<span>${escapeHtml(ti(
        isExtension ? 'anticipation.extendButton' : 'anticipation.button',
        { days: selectedDays },
        `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} ${selectedDays} jour${selectedDays > 1 ? 's' : ''}`
      ))}</span>`;
      button.setAttribute('aria-label', ti(
        isExtension ? 'anticipation.extendButtonCost' : 'anticipation.buttonCost',
        { days: selectedDays, amount },
        `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} ${selectedDays} jour(s) — coût ${amount}`
      ));
      const expiry = earlyAccessExpiry(access, key, rule);
      button.title = expiry
        ? `Votre anticipation expire le ${dateLabel(expiry)}.`
        : `Validité du droit : ${Math.max(1, Number(rule?.duration_days) || 30)} jours.`;
      meta.innerHTML = anticipationMetaMarkup({
        access,
        key,
        rule,
        normalDate,
        currentDays,
        selectedDays
      });
      wrap.querySelector('.cid-purchase-cost')?.remove();
      wrap.insertAdjacentHTML('beforeend', purchaseMeta(amount));
    };
    picker.addEventListener('change', refreshCost);
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      feedback.textContent = t('anticipation.openingConfirmation', 'Ouverture de la confirmation…');
      feedback.classList.remove('is-error');
      try {
        const result = await onPurchase(
          rule,
          date,
          Number(picker.value) || 1,
          button
        );
        if (!result?.ok) {
          feedback.textContent = result?.requiresAuth
            ? t('anticipation.loginToConfirm', 'Connectez-vous pour confirmer cette anticipation.')
            : result?.error || (
              result?.cancelled
                ? t('anticipation.cancelled', 'Anticipation annulée.')
                : t('anticipation.unavailable', 'Anticipation impossible.')
            );
          feedback.classList.add('is-error');
        } else {
          feedback.textContent = '';
        }
      } catch (error) {
        feedback.textContent = error?.message || t('anticipation.unavailable', 'Anticipation impossible.');
        feedback.classList.add('is-error');
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      }
    });
    wrap.append(picker, button, feedback, meta);
    refreshCost();
    return wrap;
  }

  function hideOtherViews() {
    callGlobal('cidResetScrollLock', { closeModals: true, resetSurfaces: true });
    callGlobalMethod('cidNotifications', 'close', { fromHistory: true });
    callGlobal('cidCloseBalancePanel', { fromHistory: true });
    callGlobal('cidLeaveProfileView');
    callGlobalMethod('rejectedController', 'leave');
    callGlobal('hideMatriceView');
    callGlobal('hideTableauxView');
    callGlobal('cidHideDedicatedView');
    [
      'categoriesView', 'tableauxViewContainer', 'croixViewContainer',
      'matrixCalculatorPanel', 'profileViewContainer', 'notificationCenter',
      'results', 'redCross', 'redCrossClone', 'topBanner',
      'countryButtons', 'cidWalletViewContainer', 'site-plant'
    ].forEach((id) => {
      const element = get(id);
      if (!element) return;
      element.hidden = true;
      element.style.display = 'none';
      element.setAttribute('aria-hidden', 'true');
    });
  }

  function installTableauxPreviewShell() {
    const existing = get('anticipationTableauxPreviewShell');
    if (existing) {
      // Dynamic Tableaux links are appended after the application styles.
      // Move this compatibility layer to the end again so the legacy body
      // rule cannot undo the native Anticipé shell.
      document.head.appendChild(existing);
      return;
    }
    const style = document.createElement('style');
    style.id = 'anticipationTableauxPreviewShell';
    style.textContent = `
      /*
       * The official Tableaux styles are loaded on demand. Their legacy body
       * rule must not replace the native Cidmap shell on this route.
       */
      body.anticipation-active {
        display: block !important;
        align-items: initial !important;
        justify-content: initial !important;
        padding: 0 !important;
        background: var(--cid-shell-bg, #f0f2f5) !important;
        color: var(--cid-ink, #162033) !important;
        text-align: left !important;
        font-family: "Noto Sans", system-ui, sans-serif !important;
      }
      body.anticipation-active .anticipation-tableaux-scope {
        font-family: Arial, sans-serif;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  /*
   * The Tableaux stylesheet is deliberately scoped to its official route:
   * `body.tableaux-active #tableauxViewContainer`. Anticipé does not create
   * a second card implementation; it clones the official portfolio DOM.
   * Mirror the official bridge and section declarations onto that clone so
   * the same classes receive the same geometry, typography, colour and
   * subscription-surface contract.
   *
   * Declarations are not duplicated or rewritten. Only the route/container
   * prefix is changed, keeping the visual component itself pixel-identical.
   */
  function installTableauxPreviewBridge() {
    // The scoped bridge is part of the application stylesheet.
    return Promise.resolve(null);
  }

  function resultRows(payload) {
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  function futureImageMedia(kind, info) {
    const illustration = callGlobalMethod(
      'cidDailyIllustrations',
      'getIllustration',
      kind,
      info.programmeDate
    ) || callGlobal('getDailyIllustration', kind, info.programmeDate);
    if (!illustration?.src) {
      return `
        <div class="cid-fb-media anticipation-real-media anticipation-image-missing"
             aria-label="${escapeHtml(`${kind} — ${info.fullDate}`)}">
          <div class="anticipation-image-missing-label">Image du programme</div>
        </div>`;
    }
    return `
      <div class="cid-fb-media anticipation-real-media anticipation-image-media">
        <img class="anticipation-real-image"
             src="${escapeHtml(illustration.src)}"
             alt="${escapeHtml(illustration.label || kind)} — ${escapeHtml(info.fullDate)}"
             loading="lazy">
      </div>`;
  }

  /*
   * Reuse the exact coloured programme block used by Accueil. The bridge is
   * intentionally optional so an early module load still has a safe fallback.
   */
  function futurePublicationMedia(kind, info) {
    const renderer = window.cidFacebookFeed?.dailyPublicationMedia;
    if (typeof renderer === 'function') {
      const programmeDate = info.programmeDate;
      const rendered = callGlobalMethod('cidFacebookFeed', 'dailyPublicationMedia', kind, {
        ...info,
        dayIndex: programmeDate.getUTCDay(),
        weekday: programmeDate.toLocaleDateString(
          callGlobalMethod('cidTranslation', 'current') || 'fr',
          { weekday: 'long', timeZone: 'Africa/Abidjan' }
        ),
        isoDateKey: programmeDate.toISOString().slice(0, 10)
      });
      return rendered || futureImageMedia(kind, info);
    }
    return futureImageMedia(kind, info);
  }

  function resultDetailsMarkup(title, date, content) {
    if (!content) return '';
    return `
      <div class="anticipation-result-details" data-anticipation-result hidden>
        <div class="anticipation-result-details-heading">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(date)}</span>
        </div>
        <div class="anticipation-data-list">${content}</div>
      </div>`;
  }

  function matrixMedia(info, payload) {
    const rows = resultRows(payload);
    const content = rows.length
      ? rows.slice(0, 12).map((row) => `
          <div class="anticipation-data-row">
            <strong>${escapeHtml(row.name || row.country || 'Programme')}</strong>
            <span>${escapeHtml(Array.isArray(row.matrix)
              ? row.matrix.join(' · ')
              : row.code || 'Résultat validé')}</span>
          </div>`).join('')
      : '';
    return `
      ${futurePublicationMedia('matrix', info)}
      ${resultDetailsMarkup('Résultat anticipé · Matrice', info.fullDate, content)}`;
  }

  function rejectedMedia(info, payload) {
    const groups = payload?.groups || {};
    const entries = [
      ['Ghana', groups.ghana],
      ["Côte d'Ivoire", groups.coteDIvoire],
      ['Bénin', groups.benin],
      ['Niger', groups.niger],
      ['Sénégal', groups.senegal],
      ['Togo', groups.togo]
    ];
    const content = entries.map(([name, values]) => {
      const hasValues = Array.isArray(values) && values.length;
      if (!hasValues) return '';
      return `
        <div class="anticipation-data-row anticipation-number-row">
          <strong>${escapeHtml(name)}</strong>
          <span>${values.map((value) => `
            <b>${escapeHtml(String(value).padStart(2, '0'))}</b>`).join('')}</span>
        </div>`;
    }).join('');
    return `
      ${futurePublicationMedia('rejected', info)}
      ${resultDetailsMarkup('Résultat anticipé · Boules rejetées', info.fullDate, content)}`;
  }

  function crossMedia(info, payload) {
    return `
      <div class="anticipation-cross-canonical-shell">
        <div class="anticipation-cross-canonical-slot" aria-label="Croix nationale du ${escapeHtml(info.fullDate)}"></div>
      </div>`;
  }

  function lockedMediaMarkup(featureKey, date) {
    const info = publicationInfo(date);
    const key = contentKeyOf(featureKey);
    if (key === 'matrice') return matrixMedia(info, null);
    if (key === 'boules-rejetees') return rejectedMedia(info, null);
    if (key === 'croix') return crossMedia(info, null);
    if (key.startsWith('tableaux-')) return tableauMedia(info, null, key);
    return futureImageMedia('matrix', info);
  }

  function applyCrossIllustration(root, programmeDate) {
    if (!root) return;
    const illustration = callGlobalMethod(
      'cidDailyIllustrations',
      'getIllustration',
      'cross',
      programmeDate
    ) || callGlobal('getDailyIllustration', 'cross', programmeDate);
    const existing = root.querySelector('.daily-cross-illustration');

    // The source Croix is cloned from Accueil. Remove its current image first
    // so a Monday image can never leak into a future Friday preview.
    if (!illustration?.src) {
      existing?.remove();
      root.classList.remove('has-daily-cross-illustration');
      return;
    }

    const image = existing || document.createElement('img');
    image.className = 'daily-cross-illustration';
    image.src = illustration.src;
    image.alt = `${illustration.label || 'Croix nationale'} — ${illustration.date || ''}`;
    image.hidden = false;
    image.dataset.illustrationSrc = illustration.src;
    image.dataset.illustrationDate = illustration.date || '';
    image.dataset.illustrationColor = illustration.color || '';
    root.appendChild(image);
    root.classList.add('has-daily-cross-illustration');
  }

  function mountCanonicalCrossPreview(root, info, payload) {
    const slot = root.querySelector('.anticipation-cross-canonical-slot');
    const source = get('redCross');
    if (!slot || !source) return;

    const record = payload?.meta
      || payload?.record?.meta
      || payload?.record
      || payload
      || {};
    const assignment = (
      Array.isArray(record.assignment)
        ? record.assignment
        : record.crossNumbers || []
    ).map(String).slice(0, 8);
    /*
     * The canonical day palette is the source of truth for Anticipé. In
     * particular, Sunday is the official yellow cross with dark ink; using
     * the current homepage colour here made future Sunday previews inherit a
     * white/black mismatch.
     */
    const dayStyle = crossDayStyleForDate(info.programmeDate);
    const dayIndex = dayStyle.day;
    const color = dayStyle.color;
    const clone = source.cloneNode(true);
    applyCrossDayStyle(clone, info.programmeDate);

    // Reuse the exact Accueil cross DOM and CSS coordinate plane. It is a
    // visual preview only: no handlers, date picker or upload action belong
    // inside the Anticipé card.
    clone.id = 'redCross';
    clone.classList.add('cid-croix-anticipation-component');
    clone.dataset.crossReady = 'true';
    clone.dataset.crossDay = String(dayIndex);
    clone.dataset.crossInk = dayIndex === 0 ? 'dark' : 'light';
    clone.dataset.cidAnticipationPreview = 'true';
    clone.hidden = false;
    clone.removeAttribute('hidden');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.setProperty('display', 'flex', 'important');
    clone.style.setProperty('visibility', 'visible', 'important');
    clone.style.setProperty('position', 'relative', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('width', 'min(100%, 380px)', 'important');
    clone.style.setProperty('height', 'min(92vw, 380px)', 'important');
    clone.style.setProperty('max-width', '380px', 'important');
    clone.style.setProperty('max-height', '380px', 'important');
    clone.style.setProperty('margin', '0 auto', 'important');
    clone.style.setProperty('background', color, 'important');
    clone.style.setProperty('--redCross-bg', color, 'important');
    clone.style.setProperty('--cid-cross-color', color, 'important');
    clone.style.setProperty(
      '--cid-cross-ink',
      dayStyle.ink,
      'important'
    );
    clone.style.setProperty('pointer-events', 'none', 'important');

    clone.querySelector('#crossDatePicker')?.remove();
    clone.querySelector('#openCrossDateBtn')?.remove();
    clone.querySelector('#redCrossCopyImageBtn')?.remove();
    applyCrossIllustration(clone, info.programmeDate);
    clone.querySelector('#redCrossDate')?.replaceChildren(
      document.createTextNode(info.fullDate)
    );
    const crossNumbers = Array.from(clone.querySelectorAll('.cross-numbers .num'));
    // A Croix has exactly eight visible number positions. Never append a
    // second group of zeros when the source already contains its eight
    // positions.
    crossNumbers.slice(8).forEach((number) => number.remove());
    crossNumbers.slice(0, 8).forEach((number, index) => {
      number.textContent = assignment.length
        ? String(assignment[index] ?? '0')
        : zeroExistingDigits(number.textContent);
    });
    const termTitle = clone.querySelector('.term-title');
    const termParen = clone.querySelector('.term-paren');
    if (termTitle) termTitle.textContent = `Terminaison ${record.terminaison || '0'}`;
    if (termParen) termParen.textContent = record.term || '';
    const nationalButton = clone.querySelector('.sunday-button');
    if (nationalButton) {
      nationalButton.textContent = 'NATIONALE';
      nationalButton.classList.add('show');
    }
    const crossInk = dayStyle.ink;
    clone.querySelectorAll(
      '.cross-numbers .num, #redCrossDate, .term-title, .term-paren, ' +
      '.right-label, .redCrossFooter'
    ).forEach((element) => {
      element.style.setProperty('color', crossInk, 'important');
      element.style.setProperty('-webkit-text-fill-color', crossInk, 'important');
    });
    clone.querySelectorAll('svg .cross-line').forEach((line) => {
      line.style.setProperty('stroke', crossInk, 'important');
    });
    clone.querySelectorAll('.sunday-button').forEach((button) => {
      button.style.setProperty('background', color, 'important');
      button.style.setProperty('color', crossInk, 'important');
      button.style.setProperty('-webkit-text-fill-color', crossInk, 'important');
      button.style.setProperty('border-color', crossInk, 'important');
    });

    slot.replaceChildren(clone);
  }

  function tableauPortfolioSelector(key) {
    return TABLEAU_PORTFOLIO_SELECTORS[normalizeTableauFeatureKey(key)] || '';
  }

  function formatTableauCombination(combination) {
    if (!Array.isArray(combination) || !combination.length) return '00 + 00';
    const operator = combination.operator || '+';
    return combination
      .map((part) => previewValue(part?.value ?? part).padStart(2, '0'))
      .join(` ${operator} `);
  }

  async function ensureTableauxPreviewReady() {
    if (tableauxPreviewReadyPromise) return tableauxPreviewReadyPromise;
    tableauxPreviewReadyPromise = (async () => {
    const tableauxSource = document.querySelector(
      '#tableauxViewContainer .portfolio-universal, ' +
      '#tableauxViewContainer .portfolio-intuition, ' +
      '#tableauxViewContainer .portfolio-oracle, ' +
      '#tableauxViewContainer .portfolio-lnb, ' +
      '#tableauxViewContainer .portfolio-manual, ' +
      '#tableauxViewContainer .portfolio-standby'
    );
    if (tableauxSource) {
      /*
       * A previous visit can leave the canonical shell mounted while its
       * route-scoped stylesheet has been removed on exit.
       */
      await callGlobal('cidEnsureTableauxStyles');
      await callGlobal('cidEnsureTableauxAdminAccess');
    } else {
      await callGlobal('cidEnsureTableauxMounted');
    }
    installTableauxPreviewShell();
    await installTableauxPreviewBridge();
    })().catch((error) => {
      tableauxPreviewReadyPromise = null;
      throw error;
    });
    return tableauxPreviewReadyPromise;
  }

  function removeTableauMoreControls(root) {
    if (!root) return;
    root.querySelectorAll(
      '.cid-fb-more-button, [data-feed-action^="anticipation:tableaux-"]'
    ).forEach((element) => element.remove());
    root.querySelectorAll('button').forEach((button) => {
      const label = String(button.textContent || '').trim().toLocaleLowerCase('fr');
      if (label === 'voir plus' || label === 'see more') button.remove();
    });
  }

  function mountTableauPortfolioPreview(root, info, payload, key) {
    removeTableauMoreControls(root);
    const selector = tableauPortfolioSelector(key);
    const media = root.querySelector('.anticipation-tableau-media');
    const source = selector
      ? document.querySelector(`#tableauxViewContainer ${selector}`)
      : null;
    const planKey = normalizeTableauPlanId(key);
    const plan = resolveTableauPlan(payload, planKey);
    if (!source) return null;

    const clone = source.cloneNode(true);
    clone.classList.add('anticipation-tableaux-scope', 'cid-tableaux-scope');
    clone.hidden = false;
    clone.removeAttribute('hidden');
    /*
     * The official feed enhancer can leave a social "Voir plus" control in
     * the cloned portfolio. It becomes a first grid item on narrow screens,
     * pushing the key and cross cards out of alignment. Tableaux already
     * expose their complete structure here, so remove that control from
     * every Tableau clone while keeping likes and shares untouched.
     */
    removeTableauMoreControls(clone);
    clone.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = info.fullDate;
    });

    if (plan) {
      const keyValue = clone.querySelector('.key-container .numbers');
      const orderValue = clone.querySelector('.order-container .numbers');
      if (keyValue) keyValue.textContent = previewValue(plan.key, PREVIEW_KEY_ZERO);
      if (orderValue) orderValue.textContent = previewValue(plan.order, PREVIEW_KEY_ZERO);

      const infoValues = clone.querySelectorAll('.key-info strong');
      [plan.code, plan.filter, plan.addition].forEach((value, index) => {
        if (infoValues[index]) {
          infoValues[index].textContent = previewValue(value);
        }
      });

      /*
       * The source Tableaux DOM contains the three NAP cells, but the
       * anticipation clone previously never hydrated them from the payload.
       * Keep their order stable: NAP1, NAP1, then NAP2.
       */
      const napValues = [
        Array.isArray(plan.nap?.nap1) ? plan.nap.nap1[0] : null,
        Array.isArray(plan.nap?.nap1) ? plan.nap.nap1[1] : null,
        Array.isArray(plan.nap?.nap2) ? plan.nap.nap2.filter(Boolean).join(' ') : null
      ];
      clone.querySelectorAll('.nap-value').forEach((element, index) => {
        element.textContent = previewValue(napValues[index]);
      });
    } else {
      /*
       * Keep the exact Tableau DOM/CSS mould visible before unlock. Only the
       * protected values are masked; the future date and the full layout stay
       * ready for the later payload replacement.
       */
      maskExistingDigits(
        clone,
        '.key-container .numbers, .order-container .numbers, .key-info strong, ' +
        '.cross-number, .satellite-number, .nap-value, .created-program-key, ' +
        '.created-program-cross b, .created-program-satellites td, ' +
        '.valid-numbers-table .numbers-row td, ' +
        '.standby-week-table tbody td:not(.standby-country-cell)'
      );
      /* Keep the existing satellite rows and only replace their digits. */
      clone.querySelectorAll(
        '.standby-week-table .nap2-cell, .standby-week-table .perm-cell'
      ).forEach((element) => {
        element.textContent = zeroExistingDigits(element.textContent);
      });
      // Labels and future programme dates are intentionally not masked.
    }

    const cross = clone.querySelector('.cross');
    if (cross) {
      if (plan) {
        [
          ['.cross-number-1', plan.cross?.top],
          ['.cross-number-2', plan.cross?.bottom],
          ['.cross-number-3', plan.cross?.right],
          ['.cross-number-6', plan.cross?.left]
        ].forEach(([selectorName, value]) => {
          const element = cross.querySelector(selectorName);
          if (element) {
            const position = selectorName.replace('.cross-number-', '');
            const fallback = position === '1'
              ? PREVIEW_CROSS_ZERO.top
              : position === '2'
                ? PREVIEW_CROSS_ZERO.bottom
                : position === '3'
                  ? PREVIEW_CROSS_ZERO.right
                  : PREVIEW_CROSS_ZERO.left;
            element.textContent = previewValue(value, fallback);
          }
        });
      }
      cross.querySelectorAll('.cross-base-numbers, .cross-base-number')
        .forEach((element) => element.remove());
    }

      const satelliteTable = clone.querySelector(
      '#manualSatellites, #universalSatellites, .intuition-cross-satellites, ' +
      '.oracle-satellites, .lnb-satellites'
    );
    if (satelliteTable) {
      const rows = Array.from(satelliteTable.querySelectorAll('tr'));
      const footerIndex = rows.findIndex((row, index) =>
        index >= 2 && row.querySelector('th[colspan]')
      );
      rows.slice(2, footerIndex === -1 ? rows.length : footerIndex)
        .forEach((row) => row.remove());
      const satellites = Array.isArray(plan?.satellites) && plan.satellites.length
        ? plan.satellites
        : [null];
      satellites.forEach((satellite, index) => {
        const row = satelliteTable.insertRow(2 + index);
        row.innerHTML = `
          <td>${String(satellite?.value ?? '0').padStart(2, '0')}</td>
          <td>${formatTableauCombination(satellite?.combinations?.[0])}</td>
          <td>${formatTableauCombination(satellite?.combinations?.[1])}</td>`;
      });
    }

    clone.querySelectorAll(
      '.tableaux-access-badge, .tableaux-schema-unlock, [data-tableaux-access]'
    ).forEach((element) => element.remove());
    clone.querySelectorAll('.cid-tableaux-masked-value').forEach((element) => {
      element.classList.remove('cid-tableaux-masked-value');
    });
    clone.querySelectorAll('[data-cid-locked-extra]').forEach((element) => {
      element.hidden = false;
      element.removeAttribute('data-cid-locked-extra');
    });
    /*
     * Keep the key/cross pair horizontal even if a late legacy stylesheet
     * restores the original vertical flex layout after an Anticipé refresh.
     */
    clone.style.setProperty('display', 'grid', 'important');
    clone.style.setProperty(
      'grid-template-columns',
      'repeat(2, minmax(0, 1fr))',
      'important'
    );
    clone.style.setProperty('gap', '12px', 'important');
    clone.style.setProperty('width', '100%', 'important');
    clone.style.setProperty('min-width', '0', 'important');
    clone.style.setProperty('padding', '0', 'important');
    let keyCardCount = 0;
    Array.from(clone.children).forEach((child) => {
      const className = String(child.className || '');
      const isKeyCard = child.classList?.contains('container');
      const isFullRow = child.classList?.contains('table-container')
        || /valid-numbers|results-container/i.test(className);
      if (isKeyCard && keyCardCount < 2) {
        child.classList.add('anticipation-tableaux-key-card');
        child.style.setProperty(
          'grid-column',
          keyCardCount === 0 ? '1' : '2',
          'important'
        );
        child.style.setProperty('grid-row', '1', 'important');
        child.style.setProperty('min-width', '0', 'important');
        child.style.setProperty('width', '100%', 'important');
        keyCardCount += 1;
      } else if (isKeyCard) {
        child.style.setProperty('grid-column', '1 / -1', 'important');
        child.style.setProperty('min-width', '0', 'important');
        child.style.setProperty('width', '100%', 'important');
      } else if (isFullRow) {
        child.style.setProperty('grid-column', '1 / -1', 'important');
        child.style.setProperty('min-width', '0', 'important');
        child.style.setProperty('width', '100%', 'important');
      }
    });
    [
      '--tableaux-action-color',
      '--tableaux-action-color-strong',
      '--tableaux-action-contrast',
      '--tableaux-panel-color',
      '--tableaux-panel-color-strong'
    ].forEach((property) => {
      const value = clone.style.getPropertyValue(property).trim();
      if (value) root.style.setProperty(property, value);
    });
    if (media) {
      media.replaceWith(clone);
    } else {
      /*
       * Tableaux cards are mounted directly in Anticipé. This keeps the
       * official portfolio as the outer component instead of placing it
       * inside a social-publication media wrapper.
       */
      root.replaceChildren(clone);
    }
    removeTableauMoreControls(root);
    return clone;
  }

  function tableauMedia(info, payload, key) {
    const id = normalizeTableauPlanId(key);
    const plan = resolveTableauPlan(payload, id);
    const values = plan ? [
      ['Clé', plan?.key],
      ['Ordre', plan?.order],
      ['Code', plan?.code],
      ['Croix', plan?.cross
        ? Object.values(plan.cross).filter(Boolean).join(' · ')
        : '']
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      : [
        ['Clé', '0'],
        ['Ordre', '0'],
        ['Code', '0'],
        ['Croix', '0 · 0 · 0 · 0']
      ];
    const content = values.map(([name, value]) => `
          <div class="anticipation-data-row">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(Array.isArray(value) ? value.join(' · ') : value)}</span>
          </div>`).join('');
    return `
      <div class="cid-fb-media anticipation-real-media anticipation-tableau-media">
        <div class="anticipation-real-heading"><span>${escapeHtml(FEATURE_LABELS[key] || id)}</span><strong>${escapeHtml(info.fullDate)}</strong></div>
        <div class="anticipation-data-list">${content}</div>
      </div>`;
  }

  function canonicalSocialPostId(featureKey, date) {
    const key = contentKeyOf(featureKey);
    const normalizedDate = String(date || '').slice(0, 10);
    const publicationKey = key === 'matrice'
      ? 'matrix'
      : key === 'boules-rejetees'
        ? 'rejected'
        : key === 'croix'
          ? 'cross'
          : key;
    return `${publicationKey}:${normalizedDate}`;
  }

  /*
   * A publication card is date-bound. The date printed in the card is not
   * enough: every protected loader must also prove that its payload belongs
   * to the requested programme date before it can reach the DOM.
   */
  function payloadDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const candidate = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
  }

  function payloadProgrammeDate(result) {
    const payload = result?.payload || {};
    return payloadDate(
      payload?.date
      || payload?.programmeDate
      || payload?.programme_date
      || payload?.meta?.programmeDate
      || payload?.meta?.programme_date
      || payload?.meta?.date
      || payload?.standby?.date
      || payload?.standby?.weekDate
    );
  }

  function assertPayloadDate(result, requestedDate) {
    const requested = payloadDate(requestedDate);
    const received = payloadProgrammeDate(result);
    /*
     * Some legacy server responses do not expose their date at the root.
     * They remain readable, but whenever a date is present it must match
     * exactly. A wrong known date is never allowed to silently fall back to
     * yesterday's values.
     */
    if (requested && received && requested !== received) {
      throw new Error(
        `Publication incohérente : ${received} reçue pour ${requested}.`
      );
    }
    return result;
  }

  function publicationInfo(date) {
    const programmeDate = dateObject(date);
    return {
      programmeDate,
      fullDate: programmeDate.toLocaleDateString(
        callGlobalMethod('cidTranslation', 'current') || 'fr',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Abidjan' }
      )
    };
  }

  async function loadUnlockedPayload(key, date) {
    const requestedDate = payloadDate(date);
    const identity = currentIdentity();
    const cacheKey = `${identity}:${key}:${requestedDate}`;
    if (payloadCache.has(cacheKey)) return payloadCache.get(cacheKey);
    /*
     * A future Tableau payload is date- and entitlement-sensitive. Never
     * hydrate it from localStorage: fetch the validated session payload on
     * every new render and share only the in-flight promise in this page.
     */
    const promise = loadUnlockedPayloadFromNetwork(key, requestedDate);
    payloadCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      throw error;
    } finally {
      // Keep only the in-flight request deduplication. A resolved future
      // payload must be fetched again on the next render/session.
      if (payloadCache.get(cacheKey) === promise) {
        payloadCache.delete(cacheKey);
      }
    }
  }

  async function loadUnlockedPayloadFromNetwork(featureKey, date) {
    const key = contentKeyOf(featureKey);
    let promise;
    if (key === 'matrice') {
      promise = Promise.resolve(callGlobal('cidFetchProgrammeForDate', date))
        .then((payload) => ({ type: 'matrix', payload }));
    } else if (key === 'boules-rejetees') {
      promise = fetchRejectedBalls({ programmeDate: date })
        .then((payload) => ({ type: 'rejected', payload }));
    } else if (key === 'croix') {
      promise = fetchCroixProgrammeForDate(date)
        .then((payload) => ({ type: 'cross', payload }));
    } else if (key.startsWith('tableaux-')) {
      promise = Promise.resolve(callGlobal('cidFetchTableauxForDate', date))
        .then((payload) => ({ type: 'tableaux', payload }));
    } else {
      promise = Promise.resolve({ type: 'message', payload: null });
    }
    const result = assertPayloadDate(await promise, date);
    return result;
  }

  async function unlock(rule, date, days, button) {
    button.disabled = true;
    const key = keyOf(rule);
    const result = await callGlobal('cidUnlockEarlyAccess', key, {
      label: labelFor(rule),
      programmeDate: date,
      days,
      requiredTokens: tokenCost(rule, days),
      source: 'anticipation',
      trigger: button
    });
    if (!result?.ok) button.disabled = false;
    if (result?.ok) {
      priorityPublication = {
        key,
        date: String(date || '').slice(0, 10)
      };
      payloadCache.delete(`${currentIdentity()}:${key}:${date}`);
      // Keep the prepared future cards visible while the fresh access
      // snapshot and programme payload arrive. Only the masked values are
      // replaced once the server confirms the unlock.
      await render({ preserveView: true });
      focusPriorityPublication();
    }
    return result;
  }

  function socialPostMarkup(key, date, payload) {
    const info = publicationInfo(date);
    const label = labelFor({ feature_key: key });
    const title = `${label} · ${info.fullDate}`;
    const copy = `Disponible par anticipation · publication normale le ${info.fullDate}`;
    const postId = canonicalSocialPostId(key, date);
    const contentKey = contentKeyOf(key);
    const postType = contentKey.startsWith('tableaux-')
      ? 'tableaux'
      : contentKey === 'matrice'
        ? 'matrix'
        : contentKey === 'boules-rejetees'
          ? 'rejected'
          : contentKey === 'croix'
            ? 'cross'
            : contentKey;
    const commentsEnabled = typeof window.cidContentControl?.commentsEnabled === 'function'
      ? callGlobalMethod('cidContentControl', 'commentsEnabled', postId, postType)
      : false;
    const action = key.startsWith('tableaux-')
      ? ''
      : `anticipation:${key}:${String(date || '').slice(0, 10)}`;
    let media = '<div class="cid-fb-media anticipation-real-media"></div>';
    if (contentKey === 'matrice') media = matrixMedia(info, payload);
    else if (contentKey === 'boules-rejetees') media = rejectedMedia(info, payload);
    else if (contentKey === 'croix') media = crossMedia(info, payload);
    else if (key.startsWith('tableaux-')) media = tableauMedia(info, payload, key);

    const renderer = window.cidFacebookFeed?.postMarkup;
    if (typeof renderer !== 'function') {
      return `<div class="anticipation-fallback-publication"><strong>${escapeHtml(title)}</strong>${media}</div>`;
    }
    return callGlobalMethod('cidFacebookFeed', 'postMarkup', {
      type: postType,
      info,
      title: label,
      country: '',
      copy,
      media,
      likes: 0,
      shares: 0,
      comments: [],
      postId,
      action,
      pinned: false,
      socialEnabled: true,
      shareEnabled: true,
      commentsEnabled
    }) || `<div class="anticipation-fallback-publication"><strong>${escapeHtml(title)}</strong>${media}</div>`;
  }

  async function makeCard(rule, access, date, token, packageDates = []) {
    const key = keyOf(rule);
    const baseAccess = hasBaseFeatureAccess(access, key, rule);
    const source = directAnticipationAccess(access, key);
    const hasDirectAccess = baseAccess && source.hasAccess;
    const directRevealRequested = hasDirectAccess
      && directAnticipationReveals.has(directRevealKey(key, date));
    const unlocked = baseAccess && (
      isUnlocked(access, key, date, rule)
      || directRevealRequested
    );
    const isPackageStart = packageDates[0] === date;
    const normalDate = String(date).slice(0, 10);
    const programmeNormalDate = normalProgrammeDate();
    const currentEarlyDays = earlyAccessDays(
      access,
      key,
      programmeNormalDate
    );
    const configuredPreviewDays = Math.max(
      1,
      Math.min(3, Number(rule?.preview_days) || packageDates.length || 1)
    );
    const savedUnlock = (access?.earlyAccessUnlocks || []).find((item) => (
      keyOf(item) === key
      && String(item?.programme_date || '').slice(0, 10) === normalDate
    ));
    const card = document.createElement('article');
    card.className = `anticipation-post anticipation-publication-modal${unlocked ? ' is-unlocked' : ' is-locked'}`;
    card.dataset.anticipationFeature = key;
    card.dataset.publicationDate = normalDate;
    if (savedUnlock?.unlocked_at) {
      card.dataset.anticipatedAt = savedUnlock.unlocked_at;
    }
    const packageDays = packageDaysForAccess(
      access,
      key,
      date,
      Math.max(1, Math.min(3, packageDates.length))
    );

    const accessWidget = !baseAccess
      ? baseAccessControl(access, key, rule)
      : hasDirectAccess && !unlocked
        ? anticipationAccessControl({
          access,
          key,
          rule,
          date,
          packageDates
        })
        : null;
    const packageWidget = baseAccess && !unlocked && isPackageStart
      && packageDays > 0
      ? packageControl(
          rule,
          date,
          packageDays,
          (currentRule, currentDate, days, currentButton) => unlock(
            currentRule,
            currentDate,
            days,
            currentButton
          ),
          {
            access,
            key,
            normalDate: programmeNormalDate,
            currentDays: 0
          }
        )
      : null;

    const extensionMaxDays = packageDaysForAccess(
      access,
      key,
      date,
      configuredPreviewDays
    );
    const extensionWidget = unlocked
      && isPackageStart
      && extensionMaxDays > currentEarlyDays
      ? packageControl(
          rule,
          date,
          extensionMaxDays,
          (currentRule, currentDate, days, currentButton) => unlock(
            currentRule,
            currentDate,
            days,
            currentButton
          ),
          {
            access,
            key,
            normalDate: programmeNormalDate,
            currentDays: currentEarlyDays
          }
        )
      : null;

    /*
     * Tableaux are already complete visual components. Bring the official
     * portfolio into Anticipé as-is; do not wrap it in the social post mould
     * used by Matrice, Croix and Boules rejetées.
     */
    if (key.startsWith('tableaux-')) {
      card.className = `anticipation-tableaux-publication${unlocked ? ' is-unlocked' : ' is-locked'}`;
      card.replaceChildren();
      try {
        await ensureTableauxPreviewReady();
        if (!unlocked) {
          mountTableauPortfolioPreview(
            card,
            publicationInfo(date),
            null,
            key
          );
          if (accessWidget) card.appendChild(accessWidget);
          else if (packageWidget) card.appendChild(packageWidget);
          if (!accessWidget && !isPackageStart) {
            card.insertAdjacentHTML(
              'beforeend',
              `<p class="anticipation-muted">${escapeHtml(t('anticipation.chooseFromFirstDate', 'Choisissez le forfait depuis la première date future.'))}</p>`
            );
          } else if (!accessWidget && !packageWidget) {
            card.insertAdjacentHTML(
              'beforeend',
              `<p class="anticipation-muted">${escapeHtml(t('anticipation.accessExpiresBeforeDate', 'Votre droit d’accès expire avant cette date.'))}</p>`
            );
          }
          return card;
        }

        const result = await loadUnlockedPayload(key, date);
        if (token !== renderToken) return card;
        mountTableauPortfolioPreview(
          card,
          publicationInfo(date),
          result.payload,
          key
        );
        if (extensionWidget) {
          card.appendChild(extensionWidget);
        } else if (accessWidget) {
          card.appendChild(accessWidget);
        } else if (isPackageStart) {
          card.insertAdjacentHTML(
            'beforeend',
            anticipationMetaMarkup({
              access,
              key,
              rule,
              normalDate: programmeNormalDate,
              currentDays: currentEarlyDays
            })
          );
        }
        return card;
      } catch (_) {
        /*
         * Keep the official zero-value mould available if hydration fails.
         * No alternate card is drawn here.
         */
        try {
          await ensureTableauxPreviewReady();
          mountTableauPortfolioPreview(
            card,
            publicationInfo(date),
            null,
            key
          );
        } catch (_) {}
        if (accessWidget) card.appendChild(accessWidget);
        else if (packageWidget) card.appendChild(packageWidget);
        if (extensionWidget) {
          card.appendChild(extensionWidget);
        } else if (!accessWidget && isPackageStart) {
          card.insertAdjacentHTML(
            'beforeend',
            anticipationMetaMarkup({
              access,
              key,
              rule,
              normalDate: programmeNormalDate,
              currentDays: currentEarlyDays
            })
          );
        }
        return card;
      }
    }

    /*
     * The remaining anticipation surfaces use the social publication mould.
     * Tableaux returned above as their own official portfolio component.
     */
    card.className = `anticipation-post anticipation-publication-modal${unlocked ? ' is-unlocked' : ' is-locked'}`;
    card.innerHTML = socialPostMarkup(key, date, null);
    const post = card.querySelector('.cid-fb-post') || card;
    post.dataset.anticipationLocked = String(!unlocked);
    const body = document.createElement('div');
    body.className = 'anticipation-post-body';
    post.appendChild(body);

    if (!unlocked) {
      if (key === 'croix') {
        mountCanonicalCrossPreview(card, publicationInfo(date), null);
      }
      if (accessWidget) body.appendChild(accessWidget);
      else if (packageWidget) body.appendChild(packageWidget);
      if (extensionWidget) body.appendChild(extensionWidget);
      if (!accessWidget && !isPackageStart) {
        body.insertAdjacentHTML(
          'beforeend',
          `<p class="anticipation-muted">${escapeHtml(t('anticipation.chooseFromFirstDate', 'Choisissez le forfait depuis la première date future.'))}</p>`
        );
      } else if (!accessWidget && !packageWidget) {
        body.insertAdjacentHTML(
          'beforeend',
          `<p class="anticipation-muted">${escapeHtml(t('anticipation.accessExpiresBeforeDate', 'Votre droit d’accès expire avant cette date.'))}</p>`
        );
      }
      return card;
    }

    body.innerHTML = `<p class="anticipation-loading">${escapeHtml(t('anticipation.loadingPublication', 'Chargement de la publication validée…'))}</p>`;
    if (accessWidget) body.appendChild(accessWidget);
    else if (packageWidget) body.appendChild(packageWidget);
    try {
      const result = await loadUnlockedPayload(key, date);
      if (token !== renderToken) return card;
      card.className = 'anticipation-unlocked-publication anticipation-publication-modal';
      card.innerHTML = socialPostMarkup(key, date, result.payload);
      // In-memory only (never localStorage): used to open the daily
      // renderer for this exact, server-validated future publication.
      card.__cidAnticipationPayload = result.payload;
      if (key === 'croix') {
        mountCanonicalCrossPreview(card, publicationInfo(date), result.payload);
      }
      if (accessWidget) card.appendChild(accessWidget);
      else if (packageWidget) card.appendChild(packageWidget);
      if (extensionWidget) {
        card.appendChild(extensionWidget);
      } else if (isPackageStart) {
        card.insertAdjacentHTML(
          'beforeend',
          anticipationMetaMarkup({
            access,
            key,
            rule,
            normalDate: programmeNormalDate,
            currentDays: currentEarlyDays
          })
        );
      }
      return card;
    } catch (_) {
      body.replaceChildren();
      if (key === 'croix') {
        mountCanonicalCrossPreview(card, publicationInfo(date), null);
      }
      body.remove();
      if (packageWidget) body.appendChild(packageWidget);
      if (extensionWidget) {
        card.appendChild(extensionWidget);
      } else if (isPackageStart) {
        card.insertAdjacentHTML(
          'beforeend',
          anticipationMetaMarkup({
            access,
            key,
            rule,
            normalDate: programmeNormalDate,
            currentDays: currentEarlyDays
          })
        );
      }
      return card;
    }
  }

  async function hydrateSocialPosts(feed) {
    const posts = Array.from(feed.querySelectorAll('.cid-fb-post'))
      .filter((post) => post !== feed && post.querySelector('.cid-fb-like'));
    /*
     * The feed host is preserved across refreshes (focus, visibility, 60 s
     * timer). Wiring it on every refresh stacked one more click listener
     * each time, so a single tap toggled Like / Partager several times and
     * the buttons flickered on and off. Wire the shared handlers once.
     */
    if (feed.dataset.anticipationFeedWired !== 'true') {
      feed.dataset.anticipationFeedWired = 'true';
      callGlobalMethod('cidFacebookFeed', 'wireFeed', feed);
    }
    const hydratePost = window.cidFacebookFeed?.hydratePost;
    if (typeof hydratePost === 'function') {
      await Promise.all(posts.map((post) => (
        Promise.resolve(
          callGlobalMethod('cidFacebookFeed', 'hydratePost', post)
        ).catch(() => {})
      )));
    }
    feed.querySelectorAll(
      '.anticipation-tableaux-publication .cid-fb-more-button,' +
      '[data-anticipation-feature^="tableaux-"] .cid-fb-more-button'
    ).forEach((button) => button.remove());
    if (feed.dataset.anticipationActionsWired === 'true') return;
    feed.dataset.anticipationActionsWired = 'true';
    feed.addEventListener('click', (event) => {
      /*
       * Tapping the coloured "Programme du jour" banner of an unlocked
       * Matrice / Boules rejetées card opens the dedicated view, exactly
       * like "Voir plus" on the daily publication.
       */
      const banner = event.target.closest(
        '.cid-fb-daily-publication-media, .cid-fb-configured-publication-media'
      );
      if (banner && feed.contains(banner)) {
        const bannerPost = banner.closest('.cid-fb-post');
        if (bannerPost && openDailyRenderer(bannerPost)) {
          event.preventDefault();
          return;
        }
      }
      const button = event.target.closest('.cid-fb-more-button');
      if (!button || !feed.contains(button)) return;
      const post = button.closest('.cid-fb-post');
      if (!post) return;
      if (openDailyRenderer(post)) return;
      const details = post.querySelector('[data-anticipation-result]');
      if (!details) {
        post.querySelector('.anticipation-post-body')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        return;
      }
      const opening = details.hidden;
      details.hidden = !opening;
      post.classList.toggle('is-result-open', opening);
      button.textContent = opening ? 'Masquer' : 'Voir plus';
      if (opening) {
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  /*
   * Matrice / Boules rejetées anticipées open in the very same view, layout
   * and renderer as the daily publication. The view receives the payload
   * already validated by the server for that date, in an isolated session:
   * no recalculation, no extra request, no write into today's caches.
   */
  function openDailyRenderer(post) {
    const card = post.closest('[data-anticipation-feature]');
    const key = contentKeyOf(card?.dataset?.anticipationFeature || '');
    const date = String(card?.dataset?.publicationDate || '').slice(0, 10);
    const payload = card?.__cidAnticipationPayload;
    if (!payload || !date) return false;
    // Return to the exact card the visitor opened, without a reload flash.
    const returnScrollTop = get(VIEW_ID)?.scrollTop || 0;
    const onBack = () => callGlobal('showAnticipationView', {
      updateHistory: false,
      restoreScrollTop: returnScrollTop
    });
    if (key === 'matrice' && Array.isArray(payload.results)
      && typeof window.cidShowMatricePreview === 'function') {
      callGlobal('cidShowMatricePreview', {
        programmeDate: date,
        results: payload.results,
        onBack
      });
      return true;
    }
    if (key === 'boules-rejetees' && payload.groups
      && typeof window.showRejectedView === 'function') {
      callGlobal('showRejectedView', {
        updateHistory: false,
        date,
        preview: { payload, onBack }
      });
      return true;
    }
    return false;
  }

  function anticipationPlaceholder(entry) {
    const key = keyOf(entry.rule);
    const placeholder = document.createElement('article');
    placeholder.className = `anticipation-card-placeholder anticipation-card-placeholder--${key.replace(
      /^tableaux-/,
      'tableaux-'
    )}`;
    placeholder.dataset.anticipationFeature = key;
    placeholder.dataset.publicationDate = entry.date;
    placeholder.setAttribute('aria-busy', 'true');
    placeholder.innerHTML = `
      <span class="anticipation-placeholder-kicker">${escapeHtml(
        FEATURE_LABELS[key] || labelFor(entry.rule)
      )}</span>
      <span class="anticipation-placeholder-date">${escapeHtml(dateLabel(entry.date))}</span>
      <span class="anticipation-placeholder-line"></span>
      <span class="anticipation-placeholder-line anticipation-placeholder-line--short"></span>`;
    return placeholder;
  }

  function fallbackAnticipationCard(entry) {
    const card = document.createElement('article');
    card.className = 'anticipation-post anticipation-publication-modal is-locked';
    card.dataset.anticipationFeature = keyOf(entry.rule);
    card.dataset.publicationDate = entry.date;
    card.innerHTML = `
      <div class="anticipation-fallback-publication">
        <strong>${escapeHtml(FEATURE_LABELS[keyOf(entry.rule)] || labelFor(entry.rule))}</strong>
        <span>${escapeHtml(dateLabel(entry.date))}</span>
      </div>`;
    return card;
  }

  function focusPriorityPublication() {
    if (!priorityPublication) return;
    const view = get(VIEW_ID);
    const target = Array.from(
      get(MOUNT_ID)?.querySelectorAll('[data-anticipation-feature]') || []
    ).find((element) => (
      String(element.dataset.anticipationFeature || '').toLowerCase()
        === priorityPublication.key
      && String(element.dataset.publicationDate || '').slice(0, 10)
        === priorityPublication.date
    ));
    if (!view || !target) return;
    const top = Math.max(0, target.offsetTop - 8);
    view.scrollTo({ top, left: 0, behavior: 'smooth' });
    target.querySelector(
      '[data-anticipation-reveal], .anticipation-unlock-button, ' +
      '[data-anticipation-individual]'
    )?.focus?.({ preventScroll: true });
  }

  async function renderPage({ preserveView = false } = {}) {
    const mount = get(MOUNT_ID);
    if (!mount) return;
    const token = ++renderToken;
    if (!preserveView || !mount.querySelector('.anticipation-feed')) {
      mount.innerHTML = `
        <div class="anticipation-feed" aria-live="polite">
          <p class="anticipation-loading">${escapeHtml(t('anticipation.loadingAccess', 'Lecture des accès configurés…'))}</p>
        </div>`;
    }
    const feed = mount.querySelector('.anticipation-feed');
    if (!feed) return;
    let access = null;
    try {
      // Anticipation cards are entitlement-sensitive. Always wait for the
      // current database snapshot so an account switch cannot reuse the
      // previous user's unlocked future publication.
      access = await callGlobalMethod('cidFeatureAccess', 'refresh');
    } catch (_) {}
    if (token !== renderToken) return;
    const rules = (access?.earlyAccessRules || [])
      .filter((rule) => (
        keyOf(rule)
        && rule?.enabled === true
      ));
    if (!rules.length) {
      feed.innerHTML = `<p class="anticipation-empty">${escapeHtml(t('anticipation.noneConfigured', 'Aucune publication anticipée n’est actuellement configurée.'))}</p>`;
      return;
    }

    const entries = rules.flatMap((rule, ruleIndex) => {
      const packageDates = previewDates(rule);
      return datesForRule(access, rule).map((date, dateIndex) => ({
        rule,
        date,
        packageDates,
        ruleIndex,
        dateIndex,
        unlocked: isUnlocked(access, keyOf(rule), date, rule)
      }));
    }).sort((left, right) => {
      const isPriority = (entry) => Boolean(
        priorityPublication
        && entry.unlocked
        && keyOf(entry.rule) === priorityPublication.key
        && entry.date === priorityPublication.date
      );
      return Number(isPriority(right)) - Number(isPriority(left))
        || Number(right.unlocked) - Number(left.unlocked)
        || right.date.localeCompare(left.date)
        || left.ruleIndex - right.ruleIndex
        || left.dateIndex - right.dateIndex;
    });

    if (!entries.length) {
      feed.innerHTML = `<p class="anticipation-empty">${escapeHtml(t('anticipation.noneAvailable', 'Aucune publication future n’est actuellement disponible en anticipation.'))}</p>`;
      return;
    }

    /*
     * Keep the feed geometry stable while future payloads are loading. The
     * old sequential append caused every resolved request to push the next
     * card down the page and made the route feel like it was jumping.
     */
    const existingCards = preserveView
      ? Array.from(feed.querySelectorAll(':scope > [data-anticipation-feature]'))
      : [];
    const placeholders = entries.map(anticipationPlaceholder);
    /*
     * Keep the current cards mounted while a refresh is hydrating new data.
     * Replacing them immediately with placeholders is what caused the route
     * to flash and detached the confirmation feedback from the clicked card.
     */
    if (
      !preserveView
      || !existingCards.length
      || existingCards.length !== entries.length
    ) {
      feed.replaceChildren(...placeholders);
    }
    const cards = await Promise.all(entries.map(async (entry) => {
      try {
        return await makeCard(
          entry.rule,
          access,
          entry.date,
          token,
          entry.packageDates
        );
      } catch (_) {
        return fallbackAnticipationCard(entry);
      }
    }));
    if (token !== renderToken) return;

    /*
     * Keep the component host mounted across a refresh. Replacing an entire
     * card while the visitor is scrolling makes Safari discard its geometry
     * anchor for one frame, which is the source of the large white gaps seen
     * on mobile. Patch the existing card shell in place and move only the
     * freshly rendered children into it.
     */
    const patchCardInPlace = (target, fresh) => {
      if (!target || !fresh) return fresh;
      target.className = fresh.className;
      Array.from(fresh.attributes || []).forEach((attribute) => {
        if (attribute.name === 'class') return;
        target.setAttribute(attribute.name, attribute.value);
      });
      Array.from(target.attributes || []).forEach((attribute) => {
        if (
          attribute.name.startsWith('data-')
          && !fresh.hasAttribute(attribute.name)
        ) {
          target.removeAttribute(attribute.name);
        }
      });
      target.replaceChildren(...Array.from(fresh.childNodes));
      /*
       * Keep the in-memory server payload with the patched card. Without it
       * a refresh made "Voir plus" fall back to the compact inline list
       * instead of opening the same view as the daily publication.
       */
      if (fresh.__cidAnticipationPayload) {
        target.__cidAnticipationPayload = fresh.__cidAnticipationPayload;
      } else {
        delete target.__cidAnticipationPayload;
      }
      window.cidComponentRuntime?.mark?.(target, {
        type: target.dataset.anticipationFeature?.startsWith('tableaux-')
          ? 'tableaux'
          : 'anticipation'
      });
      return target;
    };

    if (preserveView && existingCards.length === cards.length) {
      cards.forEach((card, index) => patchCardInPlace(existingCards[index], card));
    } else {
      cards.forEach((card, index) => placeholders[index]?.replaceWith(card));
    }
    await hydrateSocialPosts(feed);
  }

  async function render(options = {}) {
    if (renderInFlight) return renderInFlight;
    const task = renderPage(options);
    renderInFlight = task;
    try {
      return await task;
    } finally {
      if (renderInFlight === task) renderInFlight = null;
    }
  }

  async function showAnticipationView({
    updateHistory = true,
    focusFeature = '',
    restoreScrollTop = null
  } = {}) {
    const view = get(VIEW_ID);
    if (!view) return false;
    /*
     * Coming back from the Matrice / Boules rejetées renderer: keep the
     * already-mounted cards of the same account on screen and refresh them
     * in place, instead of flashing the loading state and rebuilding.
     */
    const identity = currentIdentity();
    const canPreserve = Boolean(
      lastRenderIdentity === identity
      && get(MOUNT_ID)?.querySelector('.anticipation-feed > [data-anticipation-feature]')
    );
    hideOtherViews();
    callGlobal('cidShowDedicatedView', {
      id: 'anticipe',
      title: 'Anticipé',
      onBack: () => callGlobal('showHomeView')
    });
    document.body.classList.remove(
      'accueil-active', 'categories-active', 'calculator-active',
      'rejected-active', 'matrice-active', 'archive-active',
      'tableaux-active', 'croix-active', 'anticipation-active'
    );
    document.body.classList.add('anticipation-active');
    window.__activeTab = 'anticipe';
    window.__currentCategory = 'anticipe';
    callGlobalMethod('cidRoutePersistence', 'remember', 'anticipe');
    view.hidden = false;
    view.style.display = 'block';
    view.setAttribute('aria-hidden', 'false');
    view.scrollTop = canPreserve && Number.isFinite(Number(restoreScrollTop))
      ? Number(restoreScrollTop)
      : 0;
    callGlobal('setBottomNavActiveTab', 'anticipe');
    if (!anticipationRefreshTimer) {
      // Anticipations roll over only at the 16:00 UTC generation boundary:
      // re-read them then instead of polling every minute.
      anticipationRefreshTimer = true;
      window.addEventListener('cid:programme-boundary', () => {
        payloadCache.clear();
        if (document.body.classList.contains('anticipation-active')) {
          render({ preserveView: true });
        }
      });
    }
    installTableauxPreviewShell();
    await installTableauxPreviewBridge();
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'anticipe');
      history.pushState({ ...(history.state || {}), view: 'anticipe' }, '', url.toString());
    }
    lastRenderIdentity = identity;
    await render({ preserveView: canPreserve });
    /*
     * A successful Tableau unlock can send the visitor here directly. Keep
     * the new secondary action precise by landing on that Tableau's future
     * publication instead of making the visitor search the whole catalogue.
     */
    const requestedFeature = String(focusFeature || '').toLowerCase();
    if (requestedFeature) {
      const target = Array.from(
        get(MOUNT_ID)?.querySelectorAll('[data-anticipation-feature]') || []
      ).find((element) => (
        String(element.dataset.anticipationFeature || '').toLowerCase()
          === requestedFeature
      ));
      if (target) {
        window.requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.querySelector(
            '[data-anticipation-reveal], .anticipation-unlock-button, ' +
            '[data-anticipation-individual]'
          )?.focus?.({ preventScroll: true });
        });
      }
    }
    focusPriorityPublication();
    return true;
  }

  function hideAnticipationView() {
    const view = get(VIEW_ID);
    if (view) {
      view.hidden = true;
      view.style.display = 'none';
      view.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('anticipation-active');
    // The boundary listener stays registered (it only re-renders while the
    // view is active) so it is never added twice.
    get('anticipationTableauxPreviewShell')?.remove();
    tableauxPreviewReadyPromise = null;
    callGlobal('cidReleaseTableauxStyles');
    if (document.body.dataset.cidDedicatedView === 'anticipe') {
      callGlobal('cidHideDedicatedView');
    }
  }

  function init() {
    window.showAnticipationView = showAnticipationView;
    window.hideAnticipationView = hideAnticipationView;
    window.addEventListener('cid:feature-access-changed', () => {
      if (document.body.classList.contains('anticipation-active')) {
        payloadCache.clear();
        render({ preserveView: true });
      }
    });
    window.addEventListener('cid:auth-sync', () => {
      directAnticipationReveals.clear();
      payloadCache.clear();
      if (document.body.classList.contains('anticipation-active')) {
        render({ preserveView: true });
      }
    });
    window.addEventListener('cid:admin-access-updated', () => {
      if (document.body.classList.contains('anticipation-active')) {
        payloadCache.clear();
        render({ preserveView: true });
      }
    });
    window.addEventListener('cid:payment-validated', () => {
      if (document.body.classList.contains('anticipation-active')) {
        payloadCache.clear();
        render({ preserveView: true });
      }
    });
    window.addEventListener('cid:feature-unlocked', () => {
      if (document.body.classList.contains('anticipation-active')) {
        render({ preserveView: true });
      }
    });
    window.addEventListener('cid:early-access-unlocked', (event) => {
      if (!document.body.classList.contains('anticipation-active')) return;
      const key = String(event.detail?.featureKey || '').toLowerCase();
      const date = String(event.detail?.programmeDate || '').slice(0, 10);
      if (key && date) priorityPublication = { key, date };
      render({ preserveView: true }).then(focusPriorityPublication).catch(() => {});
    });
    window.addEventListener('cid:language-change', () => {
      if (document.body.classList.contains('anticipation-active')) {
        render({ preserveView: true });
      }
    });
    window.addEventListener('focus', () => {
      if (document.body.classList.contains('anticipation-active')) {
        payloadCache.clear();
        render({ preserveView: true });
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible'
        && document.body.classList.contains('anticipation-active')
      ) {
        payloadCache.clear();
        render({ preserveView: true });
      }
    });
    window.addEventListener('cidgroup:illustrations-updated', () => {
      // The public catalogue loads asynchronously. Re-rendering here ensures
      // an Anticipé card that opened before the catalogue response receives
      // the image for its own future date.
      if (document.body.classList.contains('anticipation-active')) {
        render({ preserveView: true });
      }
    });
    window.addEventListener('popstate', (event) => {
      const section = new URLSearchParams(window.location.search).get('section');
      if (event.state?.view === 'anticipe' || section === 'anticipe') {
        showAnticipationView({ updateHistory: false });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
