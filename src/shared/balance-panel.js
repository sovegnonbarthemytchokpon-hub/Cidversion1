/*
 * Dedicated wallet and payment flow for the header wallet action.
 *
 * The balance is always read from the authenticated Supabase session. The
 * payment destination and instructions are read from the same administrator
 * configuration used by the protected access flow.
 */
(function initCidBalancePanel() {
  'use strict';

  let dialog = null;
  let status = null;
  let content = null;
  let access = null;
  let loading = false;
  let activePurchase = '';
  let purchaseNotice = '';
  let purchaseNoticeKind = '';
  let purchaseQuantity = 1;
  let purchaseContext = null;
  let loadError = '';
  let authState = 'unknown';
  let routeHistoryActive = false;
  const getStats = () => window.cidUserStats?.get?.() || {
    etoilesGagnees: 0,
    jetons: 0
  };

  const clean = (value, fallback = '') => {
    const text = String(value ?? '').trim();
    return text || fallback;
  };
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const ti = (key, values = {}, fallback = key) => (
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value ?? '')),
      t(key, fallback)
    )
  );

  const number = (value) => Math.max(0, Number(value) || 0);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value) {
    return number(value).toLocaleString(
      window.cidTranslation?.current?.() || 'fr'
    );
  }

  function formatMoney(value, pricing) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'Tarif indisponible';
    const symbol = clean(
      pricing?.currency_symbol
        || pricing?.currency_code
        || (pricing?.price_xof != null ? 'XOF' : '')
    );
    return `${amount.toLocaleString(window.cidTranslation?.current?.() || 'fr', {
      minimumFractionDigits: amount % 1 ? 2 : 0,
      maximumFractionDigits: 2
    })} ${symbol}`.trim();
  }

  function currentCountryCode() {
    const selected = document.getElementById('profileCountryInput')?.value
      || window.cidSmartCountry?.get?.()
      || window.__cidUserCountry
      || localStorage.getItem('firstVisitCountry')
      || '';
    const codes = {
      'Côte d’Ivoire': 'CI',
      "Côte d'Ivoire": 'CI',
      'Bénin': 'BJ',
      'Niger': 'NE',
      'Ghana': 'GH',
      'Sénégal': 'SN',
      'Togo': 'TG'
    };
    return codes[selected] || String(selected).trim().toUpperCase() || 'DEFAULT';
  }

  function normalizedCountryCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return code || 'DEFAULT';
  }

  function balanceMountTarget() {
    let surface = document.getElementById('cidWalletViewContainer');
    if (!surface) {
      surface = document.createElement('section');
      surface.id = 'cidWalletViewContainer';
      surface.className = 'cid-layout-surface cid-wallet-view-container';
      surface.hidden = true;
      surface.setAttribute('aria-hidden', 'true');
      document.body.appendChild(surface);
    }
    return surface;
  }

  function ensureDialog() {
    if (dialog) {
      if (!dialog.isConnected) document.body.appendChild(dialog);
      return dialog;
    }
    dialog = balanceMountTarget();
    dialog.id = 'cidBalanceDialog';
    dialog.className = 'cid-balance-dialog cid-wallet-view-container cid-layout-surface';
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
    dialog.setAttribute('role', 'region');
    dialog.setAttribute('aria-labelledby', 'cidBalanceTitle');
    dialog.innerHTML = `
      <div class="cid-balance-page">
        <header class="cid-balance-page__header">
          <button class="cid-balance-page__back cid-back-button" type="button" data-cid-back-button="true" data-balance-close aria-label="${escapeHtml(t('balance.back', 'Retour'))}">
            <svg class="cid-back-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m15 18-6-6 6-6"></path>
            </svg>
            <span>${escapeHtml(t('balance.back', 'Retour'))}</span>
          </button>
          <div class="cid-balance-card__heading">
            <span class="cid-balance-card__eyebrow">${escapeHtml(t('balance.wallet', 'Portefeuille'))}</span>
            <h1 id="cidBalanceTitle">${escapeHtml(t('balance.walletPurchase', 'Portefeuille & achat'))}</h1>
          </div>
          <p class="cid-balance-page__intro" data-balance-page-intro>${escapeHtml(t('balance.intro', 'Gérez votre solde et choisissez un pack de jetons.'))}</p>
        </header>
        <div class="cid-balance-card__body">
          <div class="cid-balance-content" data-balance-content></div>
          <p class="cid-balance-status" data-balance-status role="status" aria-live="polite"></p>
        </div>
      </div>`;
    // Keep the wallet inside its own dedicated application surface. It must
    // never be mounted as a floating child of the results feed.
    document.body.appendChild(dialog);
    content = dialog.querySelector('[data-balance-content]');
    status = dialog.querySelector('[data-balance-status]');
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-balance-close]')) close();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    return dialog;
  }

  function setStatus(message = '', kind = '') {
    if (!status) return;
    status.textContent = message;
    status.className = `cid-balance-status${kind ? ` is-${kind}` : ''}`;
  }

  function pricingFor(currency) {
    const isTokens = currency === 'tokens';
    const singularKey = isTokens ? 'tokenPricing' : 'starPricing';
    const listKey = isTokens ? 'tokenPrices' : 'starPrices';
    const rows = Array.isArray(access?.[listKey]) ? access[listKey] : [];
    if (isTokens) {
      return rows.find((item) => Number(item?.price_xof) > 0) || null;
    }
    const amountKey = 'price_per_star';
    const country = normalizedCountryCode(access?.countryCode || currentCountryCode());
    const configured = access?.[singularKey];
    const hasAmount = (item) => Number(item?.[amountKey] ?? item?.[isTokens ? 'pricePerToken' : 'pricePerStar']) > 0;
    return (hasAmount(configured) ? configured : null)
      || rows.find((item) => normalizedCountryCode(item?.country_code || item?.countryCode) === country && hasAmount(item))
      || rows.find((item) => normalizedCountryCode(item?.country_code || item?.countryCode) === 'DEFAULT' && hasAmount(item))
      || null;
  }

  function pricingRows(currency) {
    const isTokens = currency === 'tokens';
    const listKey = isTokens ? 'tokenPrices' : 'starPrices';
    const rows = Array.isArray(access?.[listKey]) ? access[listKey] : [];
    if (isTokens) {
      return rows
        .filter((row) => Number.isFinite(Number(row?.price_xof)) && Number(row.price_xof) > 0)
        .sort((left, right) => String(left?.pack_id || '').localeCompare(String(right?.pack_id || '')));
    }
    const amountKey = 'price_per_star';
    const alternateKey = 'pricePerStar';
    const country = normalizedCountryCode(access?.countryCode || currentCountryCode());
    const valid = rows.filter((row) => {
      const value = Number(row?.[amountKey] ?? row?.[alternateKey]);
      return Number.isFinite(value) && value > 0;
    });
    return [...valid].sort((left, right) => {
      const leftSelected = normalizedCountryCode(left?.country_code || left?.countryCode) === country;
      const rightSelected = normalizedCountryCode(right?.country_code || right?.countryCode) === country;
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return String(left?.country_name || left?.country_code || '').localeCompare(
        String(right?.country_name || right?.country_code || ''),
        'fr'
      );
    });
  }

  function tokenPurchaseContext() {
    if (activePurchase !== 'tokens' || !purchaseContext) return null;
    const currentTokens = number(access?.tokens ?? purchaseContext.currentTokens);
    const requiredTokens = number(purchaseContext.requiredTokens);
    return {
      currentTokens,
      requiredTokens,
      missingTokens: Math.max(0, requiredTokens - currentTokens)
    };
  }

  function currencyEnabled(currency) {
    return typeof window.cidCurrencyMode?.enabled === 'function'
      ? window.cidCurrencyMode.enabled(currency)
      : true;
  }

  function balanceRows() {
    const stats = getStats();
    const stars = access ? number(access.stars) : number(stats.etoilesGagnees);
    const tokens = access ? number(access.tokens) : number(stats.jetons);
    const rows = [];
    if (currencyEnabled('stars')) {
      rows.push(`
        <article class="cid-balance-value cid-balance-value--stars">
          <span class="cid-balance-value__icon" aria-hidden="true">★</span>
          <div><span>${escapeHtml(t('balance.stars', 'Étoiles'))}</span><strong>${formatNumber(stars)}</strong></div>
        </article>`);
    }
    if (currencyEnabled('tokens')) {
      rows.push(`
        <article class="cid-balance-value cid-balance-value--tokens">
          <span class="cid-balance-value__icon" aria-hidden="true">✦</span>
          <div><span>${escapeHtml(t('balance.tokens', 'Jetons'))}</span><strong>${formatNumber(tokens)}</strong></div>
        </article>`);
    }
    return `
      <section class="cid-balance-hero" aria-labelledby="cidBalanceHeroTitle">
        <div class="cid-balance-hero__heading">
          <div>
            <span class="cid-balance-card__eyebrow">${escapeHtml(t('balance.yourBalance', 'Votre solde'))}</span>
            <h2 id="cidBalanceHeroTitle">${escapeHtml(t('balance.myWallet', 'Mon portefeuille'))}</h2>
          </div>
          <span class="cid-balance-hero__status">${escapeHtml(t('balance.updated', 'Actualisé'))}</span>
        </div>
        <div class="cid-balance-values cid-balance-values--${rows.length === 1 ? 'single' : 'dual'}" aria-label="${escapeHtml(t('balance.availableBalances', 'Soldes disponibles'))}">${rows.join('')}</div>
      </section>`;
  }

  function purchaseButtons() {
    const buttons = [];
    if (currencyEnabled('tokens')) {
      buttons.push(`
        <button class="cid-balance-purchase" type="button" data-balance-purchase="tokens">
          <span class="cid-balance-purchase__icon" aria-hidden="true">✦</span>
          <span><strong>${escapeHtml(t('balance.buyTokens', 'Acheter des jetons'))}</strong><small>${escapeHtml(t('balance.tokensPurpose', 'Pour vos offres virtuelles'))}</small></span>
          <span class="cid-balance-purchase__arrow" aria-hidden="true">›</span>
        </button>`);
    }
    return `<div class="cid-balance-purchases">${buttons.join('')}</div>`;
  }

  function purchaseDetails(currency) {
    const packRows = currency === 'tokens' ? pricingRows('tokens') : [];
    const pricing = currency === 'tokens' ? (packRows[0] || null) : pricingFor(currency);
    const tokenContext = tokenPurchaseContext();
    const label = currency === 'tokens'
      ? t('balance.tokenSingular', 'jeton')
      : t('balance.starSingular', 'étoile');
    const plural = currency === 'tokens'
      ? t('balance.tokenPlural', 'jetons')
      : t('balance.starPlural', 'étoiles');
    const priceKey = currency === 'tokens' ? 'price_xof' : 'price_per_star';
    const unitPrice = Number(pricing?.[priceKey] ?? pricing?.[currency === 'tokens' ? 'pricePerToken' : 'pricePerStar']);
    const hasPrice = Number.isFinite(unitPrice) && unitPrice > 0;
    const initialQuantity = Math.max(
      1,
      Math.min(1000000, Math.trunc(Number(
        tokenContext?.missingTokens || purchaseQuantity
      ) || 1))
    );
    const initialTotal = currency === 'tokens'
      ? unitPrice
      : Number((unitPrice * initialQuantity).toFixed(2));
    const priceLine = hasPrice
      ? currency === 'tokens'
        ? `${escapeHtml(formatNumber(pricing.quantity))} jetons = ${escapeHtml(formatMoney(unitPrice, pricing))}`
        : `1 ${label} = ${escapeHtml(formatMoney(unitPrice, pricing))}`
        : currency === 'tokens'
          ? t('balance.noPack', 'Aucun pack disponible')
          : t('balance.priceUnavailable', 'Tarif indisponible pour ce pays');
    // Seuls les jetons utilisent le guichet Paystack. Le prix est affiché pour
    // informer l'utilisateur, mais le serveur le recalcule depuis le tarif
    // Supabase au moment de créer la transaction.
    const actions = [`
      <button class="cid-balance-payment-button cid-balance-payment-button--online"
              type="button" data-balance-buy-paystack>
        <span aria-hidden="true">↗</span>
        <span data-balance-buy-label>${escapeHtml(currency === 'tokens' ? t('balance.validatePurchase', 'Valider l’achat') : t('balance.buyStars', 'Acheter des étoiles'))}</span>
      </button>`];
    const tokenSummary = tokenContext ? `
      <div class="cid-balance-token-summary" aria-label="${escapeHtml(t('balance.requiredBalance', 'Calcul du solde nécessaire'))}">
        <div>
          <span>${escapeHtml(t('balance.currentBalance', 'Solde actuel'))}</span>
          <strong>${formatNumber(tokenContext.currentTokens)} ${tokenContext.currentTokens === 1 ? t('balance.tokenSingular', 'jeton') : t('balance.tokenPlural', 'jetons')}</strong>
        </div>
        <div>
          <span>${escapeHtml(t('balance.formulaCost', 'Coût de la formule'))}</span>
          <strong>${formatNumber(tokenContext.requiredTokens)} ${tokenContext.requiredTokens === 1 ? t('balance.tokenSingular', 'jeton') : t('balance.tokenPlural', 'jetons')}</strong>
        </div>
        <div class="${tokenContext.missingTokens ? '' : 'is-covered'}">
          <span>${escapeHtml(tokenContext.missingTokens ? t('balance.missingTokens', 'Jetons manquants') : t('balance.sufficientBalance', 'Solde suffisant'))}</span>
          <strong>${formatNumber(tokenContext.missingTokens)} ${tokenContext.missingTokens === 1 ? t('balance.tokenSingular', 'jeton') : t('balance.tokenPlural', 'jetons')}</strong>
        </div>
      </div>` : '';
    const packPicker = currency === 'tokens' && packRows.length ? `
      <label class="cid-balance-quantity">
        <span>${escapeHtml(t('balance.tokenPack', 'Pack de jetons'))}</span>
        <select data-balance-pack aria-label="${escapeHtml(t('balance.tokenPack', 'Pack de jetons'))}">
          ${packRows.map((row) => `<option value="${escapeHtml(row.pack_id)}">
            ${escapeHtml(clean(row.name, row.pack_id))} · ${escapeHtml(formatNumber(row.quantity))} jetons · ${escapeHtml(formatMoney(row.price_xof, row))}
          </option>`).join('')}
        </select>
      </label>` : '';
    return `
      <section class="cid-balance-purchase-detail" aria-labelledby="cidBalancePurchaseTitle">
        <div class="cid-balance-purchase-detail__intro">
          <span class="cid-balance-card__eyebrow">${escapeHtml(t('balance.orderConfiguration', 'Configuration de la commande'))}</span>
          <p id="cidBalancePurchaseTitle">${escapeHtml(t('balance.choosePack', 'Choisissez votre pack et vérifiez le total avant validation.'))}</p>
        </div>
        <div class="cid-balance-summary" data-balance-summary>
          ${tokenSummary}
          <div class="cid-balance-summary__unit">
            <span class="cid-balance-price">${priceLine}</span>
            <span class="cid-balance-country">${hasPrice
              ? currency === 'tokens'
                ? t('balance.universalPrices', 'Prix universels actualisés depuis l’administration')
                : `${escapeHtml(clean(pricing?.country_name, t('balance.yourCountry', 'Votre pays')))} · ${t('balance.adminUpdatedPrice', 'prix actualisé depuis l’administration')}`
              : t('balance.askAdminPrice', 'Demandez à l’administration de configurer ce tarif.')}</span>
          </div>
          ${packPicker}
          <label class="cid-balance-quantity"${currency === 'tokens' ? ' hidden' : ''}>
            <span>${escapeHtml(ti('balance.quantityOf', { unit: plural }, `Quantité de ${plural}`))}</span>
            <input type="number" min="1" max="1000000" step="1" value="${initialQuantity}" data-balance-quantity
                   aria-label="${escapeHtml(ti('balance.quantityOf', { unit: plural }, `Quantité de ${plural}`))}">
          </label>
        <div class="cid-balance-summary__total" aria-live="polite">
            <span>${escapeHtml(t('balance.totalXof', 'Total (XOF)'))}</span>
            <strong data-balance-total>${hasPrice ? escapeHtml(formatMoney(initialTotal, pricing)) : '—'}</strong>
          </div>
        </div>
        <div class="cid-balance-payment-actions">${actions.join('')}</div>
      </section>`;
  }

  function render() {
    if (!content) return;
    const title = dialog?.querySelector('#cidBalanceTitle');
    if (title) {
      title.textContent = activePurchase === 'tokens'
        ? t('balance.buyTokens', 'Acheter des jetons')
        : activePurchase === 'stars'
          ? t('balance.buyStars', 'Acheter des étoiles')
          : t('balance.myBalance', 'Mon solde');
    }
    const intro = dialog?.querySelector('[data-balance-page-intro]');
    if (intro) {
      intro.textContent = activePurchase
        ? t('balance.choosePackValidate', 'Choisissez un pack, vérifiez le total et validez votre commande.')
        : t('balance.intro', 'Gérez votre solde et choisissez un pack de jetons.');
    }
    if (authState === 'signed-out') {
      content.innerHTML = `
        <div class="cid-balance-login">
          <span class="cid-balance-login__icon" aria-hidden="true">↗</span>
          <strong>${escapeHtml(t('balance.loginToView', 'Connectez-vous pour voir votre solde'))}</strong>
          <button class="cid-balance-login-button" type="button" data-balance-login>${escapeHtml(t('balance.openAccount', 'Ouvrir mon compte'))}</button>
        </div>`;
      return;
    }
    if (!access) {
      content.innerHTML = (activePurchase ? '' : balanceRows())
        + (loadError
          ? `<div class="cid-balance-load-error" role="alert">
              <p>${escapeHtml(t('balance.paymentUnavailable', 'La configuration du paiement est momentanément indisponible.'))}</p>
              <button type="button" class="cid-balance-retry" data-balance-retry>${escapeHtml(t('balance.retry', 'Réessayer'))}</button>
            </div>`
          : `<p class="cid-balance-loading">${escapeHtml(t('balance.loadingPayment', 'Chargement de la configuration de paiement…'))}</p>`);
      return;
    }
    content.innerHTML = (activePurchase ? '' : balanceRows())
      + (activePurchase ? purchaseDetails(activePurchase) : purchaseButtons());
    if (activePurchase) bindPurchaseDetail();
  }

  function bindPurchaseDetail() {
    dialog?.querySelector('[data-balance-buy-paystack]')?.addEventListener('click', handlePaystackPayment);
    dialog?.querySelector('[data-balance-pack]')?.addEventListener('change', updatePurchaseTotal);
    dialog?.querySelector('[data-balance-quantity]')?.addEventListener('input', updatePurchaseTotal);
  }

  function purchaseElements() {
    return {
      quantity: dialog?.querySelector('[data-balance-quantity]'),
      total: dialog?.querySelector('[data-balance-total]')
    };
  }

  function purchaseDetailsData() {
    const currency = activePurchase;
    if (currency === 'tokens') {
      const packId = String(dialog?.querySelector('[data-balance-pack]')?.value || '').trim().toLowerCase();
      const pack = pricingRows('tokens').find((row) => String(row?.pack_id || '').toLowerCase() === packId);
      const quantity = Number(pack?.quantity);
      const total = Number(pack?.price_xof);
      return {
        currency,
        pricing: pack || null,
        packId,
        unitPrice: total,
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
        total: Number.isFinite(total) && total > 0 ? total : 0
      };
    }
    const pricing = pricingFor(currency);
    const priceKey = 'price_per_star';
    const unitPrice = Number(pricing?.[priceKey] ?? pricing?.[currency === 'tokens' ? 'pricePerToken' : 'pricePerStar']);
    const { quantity } = purchaseElements();
    const rawQuantity = String(quantity?.value ?? '').trim();
    const parsedQuantity = rawQuantity === '' ? 0 : Math.trunc(Number(rawQuantity));
    // Keep an empty field empty while the visitor replaces the default 1.
    // The minimum is enforced when preparing the order, not on every input
    // event, otherwise the first digit can never be erased on mobile.
    const amount = Number.isFinite(parsedQuantity)
      ? Math.max(0, Math.min(1000000, parsedQuantity))
      : 0;
    return {
      currency,
      pricing,
      unitPrice,
      quantity: amount,
      total: Number((unitPrice * amount).toFixed(2))
    };
  }

  function updatePurchaseTotal() {
    const { quantity, total } = purchaseElements();
    if (!quantity || !total) return;
    const data = purchaseDetailsData();
    if (data.quantity > 0 && String(quantity.value) !== String(data.quantity)) {
      quantity.value = String(data.quantity);
    }
      total.textContent = data.quantity > 0 && Number.isFinite(data.total) && data.unitPrice > 0
      ? formatMoney(data.total, data.pricing)
      : '—';
    const buyLabel = dialog?.querySelector('[data-balance-buy-label]');
    if (buyLabel) {
      buyLabel.textContent = data.currency === 'tokens'
        ? t('balance.validatePurchase', 'Valider l’achat')
        : t('balance.buyStars', 'Acheter des étoiles');
    }
    const paystackButton = dialog?.querySelector('[data-balance-buy-paystack]');
    if (paystackButton) paystackButton.disabled = !(data.quantity > 0);
  }

  async function handlePaystackPayment(event) {
    const button = event.currentTarget;
    const data = purchaseDetailsData();
    const quantity = Number(data.quantity);
    const currency = data.currency;

    if (currency !== 'tokens') {
      setStatus(t('balance.paystackTokensOnly', 'Paystack est réservé aux packs de jetons.'), 'error');
      return;
    }
    if (!data.packId) {
      setStatus(t('balance.selectTokenPack', 'Sélectionnez un pack de jetons.'), 'error');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setStatus(
        ti(
          'balance.minimumPurchase',
          { unit: currency === 'tokens' ? t('balance.tokenSingular', 'jeton') : t('balance.starSingular', 'étoile') },
          `Indiquez au moins 1 ${currency === 'tokens' ? 'jeton' : 'étoile'} à acheter.`
        ),
        'error'
      );
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus(t('balance.redirectPaystack', 'Redirection vers Paystack…'));

    try {
      const result = await window.procederAuPaiement?.(
        currency,
        { pack_id: data.packId }
      );
      if (!result) setStatus(t('balance.paymentStartFailed', 'Le paiement n’a pas pu être démarré.'), 'error');
    } catch (error) {
      const message = error?.message
        || error?.details
        || error?.hint
        || 'Impossible de démarrer le paiement Paystack.';
      alert(message);
      setStatus(message, 'error');
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function open(options = {}) {
    const root = ensureDialog();
    access = null;
    loadError = '';
    // Paystack is deliberately limited to virtual-token top-ups. Stars may
    // still exist as a legacy balance, but they cannot open a real-money
    // checkout from this surface.
    const requested = options.currency === 'tokens' ? 'tokens' : '';
    activePurchase = requested && currencyEnabled(requested) ? requested : '';
    purchaseContext = requested === 'tokens' && (
      options.planSlug || options.requiredTokens != null
    ) ? {
      planSlug: clean(options.planSlug),
      planName: clean(options.planName, 'cette formule'),
      requiredTokens: number(options.requiredTokens),
      currentTokens: number(options.currentTokens),
      includedTables: Array.isArray(options.includedTables) ? options.includedTables : [],
      durationDays: number(options.durationDays),
      returnToTableaux: options.returnToTableaux === true,
      sectionId: clean(options.sectionId)
    } : null;
    purchaseQuantity = Math.max(1, Math.min(1000000, Math.trunc(Number(
      options.quantity || purchaseContext?.requiredTokens || 1
    ) || 1)));
    purchaseNotice = clean(options.notice);
    purchaseNoticeKind = clean(options.noticeKind);
    authState = 'unknown';
    root.setAttribute('role', 'region');
    root.hidden = false;
    root.classList.add('is-open');
    root.classList.toggle('is-purchase-view', Boolean(activePurchase));
    root.setAttribute('aria-hidden', 'false');
    if (options.updateHistory !== false
      && new URLSearchParams(window.location.search).get('section') !== 'wallet') {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'wallet');
      window.history.pushState(
        { ...(window.history.state || {}), view: 'wallet' },
        '',
        url.toString()
      );
      routeHistoryActive = true;
    } else {
      routeHistoryActive = false;
    }
    window.cidRoutePersistence?.remember('wallet');
    window.cidShowDedicatedView?.({
      id: 'wallet',
      title: 'Portefeuille & achat',
      onBack: close
    });
    setStatus(
      purchaseNotice || 'Actualisation de votre solde…',
      purchaseNotice ? purchaseNoticeKind : ''
    );
    render();
    requestAnimationFrame(() => {
      root.querySelector('[data-balance-close]')?.focus({ preventScroll: true });
    });
    load();
    return true;
  }

  function close({ fromHistory = false } = {}) {
    if (!dialog) return;
    if (!fromHistory && routeHistoryActive) {
      routeHistoryActive = false;
      try {
        window.history.back();
        return;
      } catch (_) {}
    }
    dialog.classList.remove('is-open');
    dialog.classList.remove('is-purchase-view');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.hidden = true;
    window.cidHideDedicatedView?.();
    if (!fromHistory) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'accueil');
        window.history.replaceState(
          { ...(window.history.state || {}), view: 'accueil' },
          '',
          url.toString()
        );
      } catch (_) {}
      window.showHomeView?.({ updateHistory: false });
    }
  }

  /*
   * Offline copy of the last balance verified by the server, kept under the
   * signed-in account only. The live Supabase read stays the source of
   * truth; the copy is displayed only when that read fails (offline).
   */
  const OFFLINE_WALLET_NAME = 'wallet-access';
  let walletUserId = '';

  async function load() {
    if (loading) return;
    loading = true;
    loadError = '';
    walletUserId = '';
    try {
      const bridge = await window.cidSupabaseReady;
      // Read the live Supabase session first. This is intentionally done at
      // every wallet opening so the displayed balance is never a stale
      // counter from the header or a previous account state.
      let session = null;
      if (bridge?.auth?.getSession) {
        const sessionResult = await bridge.auth.getSession();
        if (sessionResult?.error) {
          throw new Error('Impossible de récupérer la session Supabase.');
        }
        session = sessionResult.data?.session || null;
      } else {
        session = await bridge?.getSession?.();
      }
      const user = session?.user || null;
      if (!user?.id) {
        authState = 'signed-out';
        access = null;
        setStatus('');
        render();
        return;
      }
      authState = 'signed-in';
      walletUserId = String(user.id);
      if (!bridge?.client?.functions?.invoke) throw new Error('Service de solde indisponible.');
      const response = await bridge.client.functions.invoke('subscription-access', {
        body: { countryCode: currentCountryCode() }
      });
      if (response.error || !response.data?.ok) {
        throw new Error(response.data?.error || response.error?.message || 'Solde indisponible.');
      }
      access = response.data.access || null;
      if (access) window.cidPersistentCache?.write?.(OFFLINE_WALLET_NAME, walletUserId, access);
      if (purchaseContext && activePurchase === 'tokens') {
        purchaseContext.currentTokens = number(access.tokens);
        purchaseQuantity = Math.max(
          1,
          Math.min(1000000, purchaseContext.requiredTokens - purchaseContext.currentTokens || 1)
        );
      }
      setStatus(purchaseNotice, purchaseNotice ? purchaseNoticeKind : '');
      render();
    } catch (error) {
      const saved = walletUserId
        ? window.cidPersistentCache?.read?.(OFFLINE_WALLET_NAME, walletUserId, Infinity)
        : null;
      if (saved?.value) {
        access = saved.value;
        loadError = '';
        setStatus(t(
          'wallet.offlineSnapshot',
          'Hors connexion : dernier solde enregistré sur cet appareil.'
        ));
        render();
        return;
      }
      loadError = error?.message || 'Impossible d’actualiser votre solde.';
      setStatus('Impossible d’actualiser le portefeuille.', 'error');
      render();
    } finally {
      loading = false;
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !dialog?.classList.contains('is-open')) return;
    if (target.closest('[data-balance-retry]')) {
      access = null;
      loadError = '';
      setStatus('Actualisation de votre solde…');
      render();
      load();
      return;
    }
    const purchase = target.closest('[data-balance-purchase]');
    if (purchase) {
      activePurchase = purchase.dataset.balancePurchase || '';
      // The selected token pack is read from the live server catalogue.
      purchaseQuantity = 1;
      dialog.classList.toggle('is-purchase-view', Boolean(activePurchase));
      setStatus('');
      render();
      return;
    }
    if (target.closest('[data-balance-login]')) {
      close();
      window.showProfileView?.();
    }
  });

  window.cidShowBalancePanel = open;
  // Keep the public hook available even if the account route module is
  // delayed or unavailable; profile-native.js delegates to this same hook.
  window.cidOpenBalancePanel = open;
  window.cidCloseBalancePanel = close;
  window.addEventListener('popstate', (event) => {
    const section = new URLSearchParams(window.location.search).get('section');
    if (dialog?.classList.contains('is-open')
      && event.state?.view !== 'wallet'
      && section !== 'wallet') {
      close({ fromHistory: true });
    }
  });
  window.addEventListener('cid:monetization-changed', () => {
    if (!dialog?.classList.contains('is-open')) return;
    if (activePurchase && !currencyEnabled(activePurchase)) {
      activePurchase = '';
      purchaseNotice = '';
      purchaseNoticeKind = '';
      setStatus('');
    }
    render();
  });
  window.addEventListener('cid:site-config-loaded', () => {
    if (dialog?.classList.contains('is-open')) render();
  });
  window.addEventListener('cid:language-change', () => {
    if (dialog?.classList.contains('is-open')) render();
  });
  window.addEventListener('cid:user-stats-changed', () => {
    if (dialog?.classList.contains('is-open') && !access) render();
  });
  window.addEventListener('cid:auth-sync', (event) => {
    if (!dialog?.classList.contains('is-open')) return;
    if (!event.detail?.id) {
      access = null;
      authState = 'signed-out';
      activePurchase = '';
      setStatus('');
      render();
      return;
    }
    load();
  });
  window.addEventListener('cid:country-change', () => {
    if (!dialog?.classList.contains('is-open')) return;
    access = null;
    setStatus('Actualisation du tarif pour votre pays…');
    render();
    load();
  });
})();
