/*
 * Public offer catalogue.
 *
 * The catalogue is deliberately read from subscription-access so visitors
 * see the same bundles, prices and promotions as authenticated users.
 */
(function initPublicOffers() {
  'use strict';

  const LABELS = Object.freeze({
    'tableaux-universelle': 'Universelle',
    'tableaux-intuition': 'Intuition',
    'tableaux-oracle': 'Oracle',
    'tableaux-lnb': 'LNB',
    'tableaux-balsa': 'Balsa Plus',
    'tableaux-standby': 'Stand-by',
    'tableaux-created': 'Programmes personnalisés',
    tableaux: 'Tous les tableaux'
  });
  const THEME_BY_FEATURE = Object.freeze({
    'tableaux-universelle': 'burgundy',
    'tableaux-intuition': 'violet',
    'tableaux-oracle': 'dark',
    'tableaux-lnb': 'blue',
    'tableaux-balsa': 'yellow',
    'tableaux-standby': 'dark',
    'tableaux-created': 'dark',
    tableaux: 'blue'
  });
  const THEMES = Object.freeze({
    blue: Object.freeze({
      accent: '#0066CC',
      strong: '#004A99',
      tint: 'rgba(0, 102, 204, .12)',
      tintStrong: 'rgba(0, 102, 204, .20)',
      ink: '#10233F',
      contrast: '#FFFFFF'
    }),
    yellow: Object.freeze({
      accent: '#FFD700',
      strong: '#D5A900',
      tint: 'rgba(255, 215, 0, .14)',
      tintStrong: 'rgba(255, 215, 0, .24)',
      ink: '#201B00',
      contrast: '#201B00'
    }),
    violet: Object.freeze({
      accent: '#4A0066',
      strong: '#9932CC',
      tint: 'rgba(74, 0, 102, .12)',
      tintStrong: 'rgba(74, 0, 102, .22)',
      ink: '#321042',
      contrast: '#FFFFFF'
    }),
    dark: Object.freeze({
      accent: '#000000',
      strong: '#000000',
      tint: 'rgba(0, 0, 0, .10)',
      tintStrong: 'rgba(0, 0, 0, .18)',
      ink: '#17171A',
      contrast: '#FFFFFF'
    }),
    burgundy: Object.freeze({
      accent: '#4A0000',
      strong: '#2F0000',
      tint: 'rgba(74, 0, 0, .11)',
      tintStrong: 'rgba(74, 0, 0, .19)',
      ink: '#3A1111',
      contrast: '#FFFFFF'
    })
  });

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const uiLocale = () => window.cidTranslation?.current?.() || 'fr';
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const localizedField = (record, field, fallback = '') => (
    window.cidTranslation?.field?.(record, field, fallback) || fallback
  );

  const labelFor = (key) => LABELS[key]
    || String(key || '').replace(/^tableaux-/, '').replace(/[-_]/g, ' ');

  const normalizeFeature = (value) => {
    const raw = value && typeof value === 'object'
      ? value.feature_key || value.featureKey || value.key || value.slug
      : value;
    const key = String(raw || '').trim().toLowerCase();
    return key === 'universelle' ? 'tableaux-universelle'
      : key === 'universal' ? 'tableaux-universelle'
        : key.startsWith('tableaux-') || key === 'tableaux' ? key
          : key ? `tableaux-${key}` : '';
  };
  const formatAmount = (value) => Math.max(0, Math.trunc(Number(value) || 0))
    .toLocaleString(uiLocale());
  const escapeStyle = (value) => String(value || '').replace(/[;"<>]/g, '');
  const themeForFeature = (feature) => THEMES[THEME_BY_FEATURE[normalizeFeature(feature)] || 'blue'];
  const themeStyle = (theme) => [
    `--cid-offer-accent:${escapeStyle(theme.accent)}`,
    `--cid-offer-strong:${escapeStyle(theme.strong)}`,
    `--cid-offer-tint:${escapeStyle(theme.tint)}`,
    `--cid-offer-tint-strong:${escapeStyle(theme.tintStrong)}`,
    `--cid-offer-ink:${escapeStyle(theme.ink)}`,
    `--cid-offer-contrast:${escapeStyle(theme.contrast)}`
  ].join(';');

  function activeSubscription(access) {
    const subscription = access?.subscription;
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.started_at && Date.parse(subscription.started_at) > Date.now()) return null;
    if (subscription.expires_at) {
      const expiresAt = Date.parse(subscription.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return subscription;
  }

  function isActivePlan(access, plan) {
    const subscription = activeSubscription(access);
    return Boolean(subscription && String(subscription.plan_slug || '') === String(plan?.slug || ''));
  }

  function expiryLabel(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 'sans date de fin';
    return new Intl.DateTimeFormat(uiLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Abidjan'
    }).format(new Date(timestamp));
  }

  function isPromotionActive(plan) {
    const regular = Number(plan?.regular_tokens) || 0;
    const current = Number(plan?.required_tokens) || 0;
    const endsAt = plan?.promotion_ends_at
      ? Date.parse(plan.promotion_ends_at)
      : NaN;
    return plan?.promotion_enabled === true
      && regular > current
      && (!Number.isFinite(endsAt) || endsAt > Date.now());
  }

  function isTableauxPlan(plan) {
    return (Array.isArray(plan?.features) ? plan.features : []).some((feature) => {
      const key = normalizeFeature(feature);
      return key === 'tableaux' || key.startsWith('tableaux-');
    });
  }

  function offerPlans(access, { tableauxOnly = false } = {}) {
    const active = activeSubscription(access);
    return (Array.isArray(access?.plans) ? access.plans : [])
      .filter((plan) => (
        plan?.enabled !== false
        || String(plan?.slug || '') === String(active?.plan_slug || '')
      ))
      .filter((plan) => !tableauxOnly || isTableauxPlan(plan))
      .filter((plan) => Array.isArray(plan.features) && plan.features.length);
  }

  function render(access, target = null, options = {}) {
    const root = target || document.getElementById('categoriesOffersPanel');
    if (!root) return;
    const tableauxOnly = options.tableauxOnly === true
      || root.dataset.tableauxOnly === 'true';
    const selectedFeature = normalizeFeature(
      options.selectedFeature || root.dataset.selectedFeature || ''
    );
    if (tableauxOnly) root.dataset.tableauxOnly = 'true';
    if (selectedFeature) root.dataset.selectedFeature = selectedFeature;
    const plans = offerPlans(access, { tableauxOnly });
    if (!plans.length) {
      root.innerHTML = '<p class="cid-public-offers__empty">Aucune offre disponible pour le moment.</p>';
      return;
    }

    const active = activeSubscription(access);
    const sortedPlans = plans.slice().sort((left, right) => (
      Number(isActivePlan(access, right)) - Number(isActivePlan(access, left))
      || Number(left?.sort_order ?? left?.position ?? 0)
        - Number(right?.sort_order ?? right?.position ?? 0)
      || String(left?.display_name || left?.slug || '').localeCompare(
        String(right?.display_name || right?.slug || ''),
        uiLocale(),
        { sensitivity: 'base' }
      )
    ));
    const selectedPlan = sortedPlans.find((plan) => (
      String(plan?.slug || '') === String(root.dataset.selectedOffer || '')
    )) || sortedPlans.find((plan) => (
      selectedFeature && (Array.isArray(plan?.features) ? plan.features : [])
        .some((feature) => normalizeFeature(feature) === selectedFeature
          || normalizeFeature(feature) === 'tableaux')
    )) || sortedPlans[0];
    if (selectedPlan) root.dataset.selectedOffer = String(selectedPlan.slug || '');
    const modalTheme = themeForFeature(selectedPlan?.features?.[0]);
    root.innerHTML = `
      <section class="cid-public-offers cid-public-offers-modal"
               data-cid-offers-modal
               style="${themeStyle(modalTheme)}"
               aria-labelledby="cidPublicOffersTitle">
        <div class="cid-public-offers__heading">
        <span class="cid-public-offers__eyebrow">Offres disponibles</span>
        <strong id="cidPublicOffersTitle">Abonnements collectifs</strong>
        </div>
        <div class="cid-public-offers__grid">
        ${sortedPlans.map((plan) => {
          const features = Array.isArray(plan.features) ? plan.features : [];
          const usesStars = plan.unlock_currency === 'stars';
          const currencyLabel = usesStars
            ? t('balance.starPlural', 'étoiles')
            : t('balance.tokenPlural', 'jetons');
          const regular = Number(
            usesStars ? plan.required_stars : plan.regular_tokens
          ) || 0;
          const current = Number(
            usesStars ? plan.required_stars : plan.required_tokens
          ) || 0;
          const promotion = isPromotionActive(plan);
          const featureText = features.map((key) => labelFor(normalizeFeature(key)));
          const isActive = isActivePlan(access, plan);
          const selected = String(root.dataset.selectedOffer || '') === String(plan.slug);
          const selectedFeature = features[0];
          const theme = themeForFeature(selectedFeature);
      const planName = localizedField(plan, 'display_name', plan.slug);
      const action = isActive
        ? t('offers.active', 'Actif')
        : `${t('offers.purchase', 'Achat')} ${formatAmount(current)}${usesStars ? ` ${currencyLabel}` : ''}`;
          const expiresAt = isActive ? active?.expires_at : '';
          return `
            <article class="cid-public-offer${isActive ? ' is-active' : ''}"
                     data-plan-slug="${escapeHtml(plan.slug)}"
                     data-plan-active="${String(isActive)}"
                     style="${themeStyle(theme)}">
              <div class="cid-public-offer__topline">
                <button type="button"
                        class="cid-public-offer__toggle"
                        data-offer-toggle="${escapeHtml(plan.slug)}"
                        aria-expanded="${selected}">
                  <strong>${escapeHtml(planName)}</strong>
                  <small>${features.length} ${escapeHtml(t('offers.includedTables', 'tableaux inclus'))}</small>
                </button>
                ${promotion
                  ? `<span class="cid-public-offer__badge">${escapeHtml(localizedField(plan, 'promotion_label', t('offers.promotion', 'Promotion')))}</span>`
                  : ''}
              </div>
              <p class="cid-public-offer__features">${escapeHtml(featureText.join(' · '))}</p>
              <div class="cid-public-offer__price">
                ${promotion ? `<s>${regular.toLocaleString(uiLocale())} ${currencyLabel}</s>` : ''}
                <strong>${current.toLocaleString(uiLocale())} ${currencyLabel}</strong>
              </div>
              <small>${Number(plan.duration_days) || 30} ${escapeHtml(t('promo.days', 'jours'))}</small>
              ${isActive
                ? `<p class="cid-public-offer__active"><b>${escapeHtml(t('offers.activeSubscription', 'Abonnement actif'))}</b><br>
                     ${escapeHtml(t('offers.exactEnd', 'Fin exacte :'))} <time datetime="${escapeHtml(expiresAt || '')}">${escapeHtml(expiryLabel(expiresAt))}</time></p>`
                : ''}
              ${selected
                ? `<div class="cid-public-offer__details">
                     <strong>${escapeHtml(t('offers.includedTablesTitle', 'Tableaux inclus'))}</strong>
                     <ul>${featureText.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
                   </div>`
                : ''}
              <button type="button"
                      class="cid-public-offer__purchase${isActive ? ' is-access-active' : ''}"
                      data-plan-purchase="${escapeHtml(plan.slug)}"
                      ${isActive ? 'disabled' : ''}
                      aria-label="${escapeHtml(action)} — ${escapeHtml(planName)}">
                ${escapeHtml(action)}
              </button>
            </article>`;
        }).join('')}
        </div>
      </section>`;
    root.querySelectorAll('[data-offer-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        root.dataset.selectedOffer = button.dataset.offerToggle || '';
        render(access, root);
      });
    });
    root.querySelectorAll('[data-plan-purchase]').forEach((button) => {
      button.addEventListener('click', async () => {
        const slug = button.dataset.planPurchase;
        const plan = sortedPlans.find((item) => String(item.slug) === String(slug));
        if (!plan || button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const result = await window.cidPurchaseSubscriptionPlan?.(slug, {
          isRenewal: isActivePlan(access, plan)
        });
        if (result && !result.ok && !result.cancelled
          && !result.requiresAuth && !result.insufficientBalance) {
          window.alert(result.error || 'Abonnement impossible.');
        }
        button.disabled = false;
        button.removeAttribute('aria-busy');
      });
    });
  }

  let lastAccess = null;
  let renderEpoch = 0;
  async function loadAccess() {
    const epoch = ++renderEpoch;
    const [config, account] = await Promise.all([
      window.cidSiteConfig?.load
        ? Promise.resolve(window.cidSiteConfig.load()).catch(() => null)
        : Promise.resolve(null),
      window.cidFeatureAccess?.load
        ? Promise.resolve(window.cidFeatureAccess.load()).catch(() => null)
        : Promise.resolve(null)
    ]);
    if (epoch !== renderEpoch) return lastAccess;
    const source = account && Array.isArray(account.plans) && account.plans.length
      ? account
      : config;
    lastAccess = source || {};
    return lastAccess;
  }

  window.cidRenderPublicOffers = async (target = null, options = {}) => {
    const panel = target || document.getElementById('categoriesOffersPanel');
    if (!panel) return;
    try {
      const access = await loadAccess();
      render(access, panel, options);
    } catch (_) {
      panel.innerHTML = `<p class="cid-public-offers__empty">${escapeHtml(
        t('offers.unavailable', 'Les offres sont momentanément indisponibles.')
      )}</p>`;
    }
  };
  window.cidRenderPublicOffersFromAccess = (access, target = null, options = {}) => {
    const panel = target || document.getElementById('categoriesOffersPanel');
    if (!panel) return;
    render(access || {}, panel, options);
  };

  window.addEventListener('cid:site-config-loaded', () => {
    if (document.getElementById('categoriesOffersPanel')?.hidden) return;
    window.cidRenderPublicOffers?.();
  });
  window.addEventListener('cid:language-change', () => {
    const panel = document.getElementById('categoriesOffersPanel');
    if (panel && !panel.hidden) window.cidRenderPublicOffers?.(panel);
  });
  window.addEventListener('cid:admin-config-updated', () => {
    window.cidRenderPublicOffers?.();
  });
  window.addEventListener('cid:subscription-unlocked', () => {
    window.cidRenderPublicOffers?.();
  });
  window.addEventListener('cid:feature-access-changed', (event) => {
    const panel = document.getElementById('categoriesOffersPanel');
    if (!panel || panel.hidden) return;
    const access = event.detail;
    if (access) {
      lastAccess = access;
      render(access, panel);
    } else {
      window.cidRenderPublicOffers?.(panel);
    }
  });
  window.addEventListener('cid:auth-sync', (event) => {
    /*
     * Repaint immediately with the public plan catalogue. No previous
     * subscription state may survive the session switch while the new
     * authenticated snapshot is being fetched.
     */
    lastAccess = lastAccess
      ? { ...lastAccess, subscription: null, activePlan: null, featureUnlocks: [] }
      : null;
    const panel = document.getElementById('categoriesOffersPanel');
    if (panel && !panel.hidden) {
      render(lastAccess || {}, panel);
      window.cidRenderPublicOffers?.(panel);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const panel = document.getElementById('categoriesOffersPanel');
      if (panel && !panel.hidden) window.cidRenderPublicOffers?.(panel);
    }
  });
})();
