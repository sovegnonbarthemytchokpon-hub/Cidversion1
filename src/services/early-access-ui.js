/*
 * Early-publication controls.
 *
 * A normal publication remains public. When the administrator activates an
 * early-access rule, this module adds an "Anticiper" action to the current
 * publication. A protected Tableau must already be unlocked; a free Tableau
 * can go directly to early access.
 */
(() => {
  'use strict';

  const FEATURES = Object.freeze([
    {
      key: 'boules-rejetees',
      label: 'Boules rejetées',
      kind: 'surface',
      root: () => document.getElementById('results')
    },
    {
      key: 'matrice',
      label: 'Matrice',
      kind: 'surface',
      root: () => document.getElementById('results')
    },
    {
      key: 'croix',
      label: 'Croix nationale',
      kind: 'croix',
      root: () => document.querySelector('.cid-croix-current-card')
    },
    {
      key: 'tableaux-universelle',
      label: 'Universelle',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-universal')
    },
    {
      key: 'tableaux-intuition',
      label: 'Intuition',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-intuition')
    },
    {
      key: 'tableaux-oracle',
      label: 'Oracle',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-oracle')
    },
    {
      key: 'tableaux-lnb',
      label: 'LNB',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-lnb')
    },
    {
      key: 'tableaux-balsa',
      label: 'Balsa Plus',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-manual')
    },
    {
      key: 'tableaux-standby',
      label: 'Stand-by',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer .portfolio-standby')
    },
    {
      key: 'tableaux-created',
      label: 'Programmes personnalisés',
      kind: 'tableau',
      root: () => document.querySelector('#tableauxViewContainer #createdProgramPortfolios')
    }
  ]);

  let renderQueued = false;
  let rendering = false;
  const observers = new Map();
  const registeredFeatures = new Map();
  const PROGRAM_GENERATION_HOUR = 16;

  const normalizeFeatureKey = (value) => String(value || '')
    .trim()
    .toLowerCase();

  function rootForDataFeature(key) {
    const wanted = normalizeFeatureKey(key);
    const elements = document.querySelectorAll(
      '[data-cid-feature-key], [data-feature-key], [data-early-access-feature]'
    );
    return [...elements].find((element) => (
      normalizeFeatureKey(
        element.dataset.cidFeatureKey
          || element.dataset.featureKey
          || element.dataset.earlyAccessFeature
      ) === wanted
    )) || null;
  }

  function dynamicFeature(ruleOrKey) {
    const key = normalizeFeatureKey(ruleOrKey?.feature_key || ruleOrKey?.featureKey || ruleOrKey);
    if (!key) return null;
    const registered = registeredFeatures.get(key);
    if (registered) return registered;
    const isTableau = key.startsWith('tableaux-');
    return {
      key,
      label: String(ruleOrKey?.display_name || ruleOrKey?.displayName || key),
      kind: key === 'croix' ? 'croix' : isTableau ? 'tableau' : 'surface',
      root: () => rootForDataFeature(key)
    };
  }

  function featuresForAccess(access) {
    const features = [...FEATURES];
    (access?.earlyAccessRules || []).forEach((rule) => {
      const key = normalizeFeatureKey(rule?.feature_key || rule?.featureKey);
      if (!key || features.some((feature) => feature.key === key)) return;
      const feature = dynamicFeature(rule);
      if (feature) features.push(feature);
    });
    registeredFeatures.forEach((feature, key) => {
      if (!features.some((item) => item.key === key)) features.push(feature);
    });
    return features;
  }

  function programmeDate() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Abidjan',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const part = (type) => Number(
      parts.find((entry) => entry.type === type)?.value
    );
    return new Date(Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + (part('hour') >= 16 ? 1 : 0)
    )).toISOString().slice(0, 10);
  }

  function nextProgrammeDate(date = programmeDate()) {
    const value = new Date(`${date}T12:00:00.000Z`);
    if (Number.isNaN(value.getTime())) return date;
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }

  function currentHour() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Abidjan',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
    return Number(parts.find((entry) => entry.type === 'hour')?.value) || 0;
  }

  function activeFeatures(access) {
    const features = featuresForAccess(access);
    if (document.body.classList.contains('rejected-active')) {
      return features.filter((feature) => feature.key === 'boules-rejetees');
    }
    if (
      document.body.classList.contains('matrice-active')
      || document.body.dataset.cidDedicatedView === 'matrice'
    ) {
      return features.filter((feature) => feature.key === 'matrice');
    }
    if (
      document.body.classList.contains('croix-active')
      || document.body.classList.contains('accueil-active')
    ) {
      return features.filter((feature) => feature.key === 'croix');
    }
    if (document.body.classList.contains('tableaux-active')) {
      return features.filter((feature) => feature.kind === 'tableau');
    }
    return features.filter((feature) => (
      !FEATURES.some((item) => item.key === feature.key)
      && feature.root?.()
    ));
  }

  function earlyRule(access, featureKey) {
    const configured = (access?.earlyAccessRules || []).find((item) => (
      normalizeFeatureKey(item?.feature_key || item?.featureKey)
        === normalizeFeatureKey(featureKey)
    ));
    if (configured) {
      return {
        ...configured,
        configured: configured.enabled === true
      };
    }
    return {
      feature_key: normalizeFeatureKey(featureKey),
      enabled: false,
      early_hour: 16,
      required_tokens: 1,
      token_cost_1_day: 1,
      configured: false
    };
  }

  function earlyAccessUnlockIsActive(unlock, rule) {
    const expiresAt = String(unlock?.expires_at || '').trim();
    if (expiresAt) {
      const expiry = Date.parse(expiresAt);
      return Number.isFinite(expiry) && expiry > Date.now();
    }

    /*
     * Older installations do not have an expires_at column on the
     * date-based unlock table. Keep those unlocks usable during the
     * migration by deriving the expiry from the rule's configured duration.
     */
    const unlockedAt = Date.parse(String(unlock?.unlocked_at || ''));
    if (!Number.isFinite(unlockedAt)) return false;
    const durationDays = Math.max(1, Number(rule?.duration_days) || 30);
    return unlockedAt + durationDays * 86400000 > Date.now();
  }

  function legacyUnlockCovers(access, key, date, rule) {
    const normal = programmeDate();
    const requested = new Date(`${date}T12:00:00.000Z`);
    const normalDate = new Date(`${normal}T12:00:00.000Z`);
    const offset = !Number.isNaN(requested.getTime())
      && !Number.isNaN(normalDate.getTime())
      ? Math.floor((requested.getTime() - normalDate.getTime()) / 86400000)
      : 0;
    if (offset <= 0) return false;

    const previewDays = Math.max(
      1,
      Math.min(30, Number(rule?.preview_days) || 1)
    );
    if (offset > previewDays) return false;

    const exactUnlock = access?.earlyAccessUnlocks?.some((item) => (
      String(item?.feature_key || '').toLowerCase() === key
      && String(item?.programme_date || '').slice(0, 10) === date
      && earlyAccessUnlockIsActive(item, rule)
    ));
    if (exactUnlock) return true;

    /*
     * Before the rolling-grant migration, an anticipation purchase was
     * stored against one calendar date (for example Monday 7 September).
     * That record is still the user's active anticipation entitlement, not
     * a reason to keep rendering that historical Monday card. Reuse it for
     * the current next programme while its configured validity lasts.
     */
    return Boolean(access?.earlyAccessUnlocks?.some((item) => (
      String(item?.feature_key || '').toLowerCase() === key
      && String(item?.programme_date || '').slice(0, 10) <= normal
      && earlyAccessUnlockIsActive(item, rule)
    )));
  }

  function unlockedToday(access, key, date, rule = null) {
    const normal = programmeDate();
    const requested = new Date(`${date}T12:00:00.000Z`);
    const normalDate = new Date(`${normal}T12:00:00.000Z`);
    const offset = !Number.isNaN(requested.getTime())
      && !Number.isNaN(normalDate.getTime())
      ? Math.floor((requested.getTime() - normalDate.getTime()) / 86400000)
      : 0;
    return Boolean(access?.earlyAccessGrants?.some((grant) => (
      String(grant?.feature_key || '').toLowerCase() === key
      && offset > 0
      && Number(grant?.days) >= offset
      && (!grant?.expires_at || Date.parse(grant.expires_at) > Date.now())
    ))) || legacyUnlockCovers(access, key, date, rule);
  }

  async function canRead(featureKey, date = programmeDate()) {
    let access = null;
    try {
      access = await window.cidFeatureAccess?.load?.({ force: true });
    } catch (_) {}
    const rule = earlyRule(access, featureKey);
    const normalDate = programmeDate();
    const requested = new Date(`${String(date).slice(0, 10)}T12:00:00.000Z`);
    const normal = new Date(`${normalDate}T12:00:00.000Z`);
    if (Number.isNaN(requested.getTime()) || Number.isNaN(normal.getTime())) {
      return false;
    }
    const offset = Math.floor(
      (requested.getTime() - normal.getTime()) / 86400000
    );
    if (offset <= 0) return true;
    const previewDays = Math.max(
      1,
      Math.min(30, Number(rule?.preview_days) || 1)
    );
    if (offset > previewDays) return false;
    return unlockedToday(
      access,
      featureKey,
      String(date).slice(0, 10),
      rule
    );
  }

  function programmeDateFor(featureKey) {
    const normalDate = programmeDate();
    const access = window.cidFeatureAccess?.state?.() || null;
    const rule = earlyRule(access, featureKey);
    const previewDate = nextProgrammeDate(normalDate);
    return rule && unlockedToday(access, featureKey, previewDate, rule)
      ? previewDate
      : normalDate;
  }

  function previewProgrammeDate() {
    return nextProgrammeDate(programmeDate());
  }

  function previewProgrammeDates(featureKey) {
    const normalDate = programmeDate();
    const access = window.cidFeatureAccess?.state?.() || null;
    const rule = earlyRule(access, featureKey);
    const days = Math.max(
      1,
      Math.min(30, Number(rule?.preview_days) || 1)
    );
    const dates = [];
    for (let offset = 1; offset <= days; offset += 1) {
      const date = new Date(`${normalDate}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
  }

  function removeControl(root) {
    root?.querySelectorAll(':scope > .cid-early-access-control')
      .forEach((control) => control.remove());
    root?.querySelectorAll('[data-croix-early-access]')
      .forEach((control) => control.remove());
  }

  function bindObserver(feature, root) {
    const previous = observers.get(feature.key);
    if (previous?.root === root) return;
    previous?.observer?.disconnect();
    if (!root) {
      observers.delete(feature.key);
      return;
    }
    const observer = new MutationObserver((mutations) => {
      const externalChange = mutations.some((mutation) => (
        !mutation.target.closest?.('.cid-early-access-control')
        && !mutation.target.closest?.('[data-croix-early-access]')
      ));
      if (externalChange) queueRender();
    });
    observer.observe(root, { childList: true, subtree: true });
    observers.set(feature.key, { root, observer });
  }

  function makeButton(feature, rule, date, unlocked, availableNow = true) {
    const requiredTokens = Math.max(
      1,
      Number(rule?.token_cost_1_day ?? rule?.required_tokens) || 1
    );
    const configured = rule?.configured !== false;
    const tokenLabel = String(requiredTokens).padStart(2, '0');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = feature.kind === 'croix'
      ? 'cid-fb-action cid-croix-action cid-croix-early-access'
      : 'cid-early-access-button';
    button.classList.add('cid-buy-button');
    if (feature.kind === 'croix') {
      button.setAttribute('data-croix-early-access', '');
    }
    button.setAttribute('aria-label', unlocked
      ? `${feature.label}, accès actif`
      : !configured
        ? `Anticiper ${feature.label}, coût ${tokenLabel}`
        : availableNow
        ? `Anticiper ${feature.label}, coût ${tokenLabel}`
        : `Anticiper ${feature.label} à ${PROGRAM_GENERATION_HOUR} heures`);
    button.innerHTML = unlocked
      ? '<span>Actif</span>'
      : requiredTokens > 0
        ? `<span class="cid-token-icon" aria-hidden="true"></span><span>Anticiper</span><span class="cid-inline-cost" aria-hidden="true">${tokenLabel}</span>`
        : '<span>Anticiper</span>';
    button.disabled = unlocked || !availableNow;
    button.classList.toggle('is-activated', unlocked);
    button.classList.toggle('is-unconfigured', !configured);
    if (!unlocked && availableNow && configured) {
      button.addEventListener('click', async () => {
        if (Number(rule?.preview_days) > 1) {
          window.showAnticipationView?.();
          return;
        }
        button.disabled = true;
        const result = await window.cidUnlockEarlyAccess?.(feature.key, {
          label: feature.label,
          programmeDate: date,
          requiredTokens,
          trigger: button
        });
        if (!result?.ok) queueRender();
      });
    }
    return button;
  }

  function renderCroix(feature, root, rule, access, date, availableNow) {
    const actions = root.querySelector('.cid-fb-actions');
    const like = actions?.querySelector('[data-croix-like]');
    if (!actions || !like) return;
    const old = actions.querySelector('[data-croix-early-access]');
    const unlocked = unlockedToday(access, feature.key, date, rule);
    const button = makeButton(feature, rule, date, unlocked, availableNow);
    old?.replaceWith(button);
    if (!old) like.after(button);
  }

  function renderSurface(feature, root, rule, access, date, availableNow) {
    const old = root.querySelector(':scope > .cid-early-access-control');
    const unlocked = unlockedToday(access, feature.key, date, rule);
    const control = old || document.createElement('aside');
    control.className = 'cid-early-access-control';
    control.setAttribute('role', 'status');
    control.replaceChildren();
    const copy = document.createElement('span');
    copy.className = 'cid-early-access-copy';
    copy.textContent = unlocked
      ? `Publication suivante disponible · ${feature.label}`
      : `Publication suivante · ${feature.label}`;
    control.appendChild(copy);
    control.appendChild(makeButton(feature, rule, date, unlocked, availableNow));
    if (!control.isConnected) root.prepend(control);
  }

  function renderFeature(feature, access) {
    const root = feature.root?.();
    if (!root) return;
    bindObserver(feature, root);

    /*
     * Tableau anticipation is handled from the dedicated “Anticipé” route.
     * Do not place a second action inside each yellow/brown Tableau card:
     * visitors must have one clear entry point for future publications.
     * Removing an already-mounted control also cleans up the DOM when the
     * access configuration is refreshed without a full page reload.
     */
    if (feature.kind === 'tableau') {
      removeControl(root);
      return;
    }

    const rule = earlyRule(access, feature.key);
    if (rule.configured === false || rule.enabled !== true) {
      removeControl(root);
      return;
    }
    const effectiveRule = rule || {
      required_tokens: 0,
      token_cost_1_day: 0,
      early_hour: 16,
      enabled: true,
      configured: true,
      defaultFree: true
    };
    const date = nextProgrammeDate(programmeDate());
    // An unlocked anticipation is readable before the normal 16:00 release.
    // The server still validates the entitlement; this flag only controls
    // whether the visitor can open the purchase/read flow.
    const availableNow = true;
    if (feature.kind === 'croix') {
      renderCroix(feature, root, effectiveRule, access, date, availableNow);
    } else {
      renderSurface(feature, root, effectiveRule, access, date, availableNow);
    }
  }

  function renderFeedControls(access) {
    const feed = document.getElementById('cid-home-feed');
    if (!feed) return;

    feed.querySelectorAll('[data-feed-early-access]').forEach((button) => {
      const key = String(button.dataset.feedEarlyAccess || '').toLowerCase();
      if (!key) return;

      if (key === 'tableaux') {
        button.disabled = false;
        button.textContent = 'Anticiper les tableaux';
        button.title = 'Ouvrir les tableaux et choisir celui à anticiper';
        if (button.dataset.earlyBound !== 'true') {
          button.addEventListener('click', () => {
            window.showTableauxView?.();
          });
          button.dataset.earlyBound = 'true';
        }
        return;
      }

      const rule = earlyRule(access, key);
      const feature = featuresForAccess(access).find((item) => item.key === key)
        || dynamicFeature(key);
      if (!feature) {
        button.disabled = true;
        button.innerHTML = '<span>Anticiper</span>';
        button.classList.add('is-unconfigured');
        button.title = 'Cette anticipation n’est pas configurée.';
        return;
      }
      if (rule.configured === false || rule.enabled !== true) {
        button.disabled = true;
        button.textContent = 'Anticipation inactive';
        button.classList.add('is-unconfigured');
        button.title = 'Cette anticipation est désactivée.';
        return;
      }

      const requiredTokens = Math.max(
        1,
        Number(rule.token_cost_1_day ?? rule.required_tokens) || 1
      );
      const tokenLabel = String(requiredTokens).padStart(2, '0');
      const date = previewProgrammeDate();
      const unlocked = unlockedToday(access, key, date, rule);
      const availableNow = true;
      button.innerHTML = unlocked
        ? '<span>Actif</span>'
        : requiredTokens > 0
          ? `<span class="cid-token-icon" aria-hidden="true"></span><span>Anticiper</span><span class="cid-inline-cost" aria-hidden="true">${tokenLabel}</span>`
          : '<span>Anticiper</span>';
      button.disabled = unlocked || !availableNow;
      button.classList.toggle('is-activated', unlocked);
      button.title = unlocked
        ? `La publication suivante de ${feature.label} est déjà anticipée.`
        : Number(rule.preview_days) > 1
          ? `Choisir un forfait d’anticipation pour ${feature.label}.`
          : `Voir immédiatement la publication suivante de ${feature.label}.`;

      if (button.dataset.earlyBound !== 'true') {
        button.addEventListener('click', async () => {
          if (Number(rule.preview_days) > 1) {
            window.showAnticipationView?.();
            return;
          }
          const result = await window.cidUnlockEarlyAccess?.(key, {
            label: feature.label,
            programmeDate: previewProgrammeDate(),
            requiredTokens,
            trigger: button
          });
          if (!result?.ok) render();
        });
        button.dataset.earlyBound = 'true';
      }
    });
  }

  function queueRender() {
    if (rendering || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    if (rendering) return;
    rendering = true;
    try {
      const access = window.cidFeatureAccess?.state?.() || null;
      renderFeedControls(access);
      activeFeatures(access).forEach((feature) => renderFeature(feature, access));
    } finally {
      rendering = false;
    }
  }

  /*
   * A future module can register its root once, without changing this
   * controller. Database rules provide the key and label; the module only
   * declares where its public card is mounted.
   */
  window.cidRegisterEarlyAccessFeature = (definition = {}) => {
    const key = normalizeFeatureKey(definition.key || definition.featureKey);
    if (!key) return false;
    const root = typeof definition.root === 'function'
      ? definition.root
      : () => {
          if (typeof definition.root === 'string') {
            return document.querySelector(definition.root);
          }
          return rootForDataFeature(key);
        };
    registeredFeatures.set(key, {
      key,
      label: String(definition.label || key),
      kind: definition.kind || (key.startsWith('tableaux-') ? 'tableau' : 'surface'),
      root
    });
    queueRender();
    return true;
  };

  window.cidEarlyAccessUi = {
    refresh: render,
    canRead,
    isUnlocked: (access, featureKey, date, rule = null) =>
      unlockedToday(access, normalizeFeatureKey(featureKey), date, rule),
    programmeDate,
    programmeDateFor,
    previewProgrammeDate,
    previewProgrammeDates
  };

  function init() {
    window.cidEarlyAccessUi = Object.freeze({
      refresh: render,
      canRead,
      isUnlocked: (access, featureKey, date, rule = null) =>
        unlockedToday(access, normalizeFeatureKey(featureKey), date, rule),
      programmeDate,
      programmeDateFor,
      previewProgrammeDate,
      previewProgrammeDates
    });
    window.addEventListener('cid:feature-access-changed', render);
    window.addEventListener('cid:feature-unlocked', render);
    window.addEventListener('cid:croix-view-show', render);
    window.addEventListener('cid:feed-rendered', render);
    window.addEventListener('cid:early-access-unlocked', (event) => {
      const featureKey = String(event.detail?.featureKey || '');
      if (event.detail?.source === 'anticipation') {
        render();
        return;
      }
      if (featureKey === 'boules-rejetees') {
        window.showRejectedView?.({ updateHistory: true });
      } else if (featureKey === 'matrice') {
        window.activateMatriceView?.();
        window.generateLottoResults?.({ force: true }).catch(() => {});
      } else if (featureKey === 'croix') {
        window.showCroixView?.({ updateHistory: true });
        window.croix?.fetchAndApply?.({ force: true });
      } else if (featureKey.startsWith('tableaux-')) {
        window.showTableauxView?.();
        window.cidRefreshTableaux?.();
      }
      render();
    });
    window.setInterval(render, 60000);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
