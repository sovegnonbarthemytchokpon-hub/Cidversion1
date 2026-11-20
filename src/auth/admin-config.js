/*
 * Compatibility facade for older browser callers.
 *
 * Configuration writes now go through the authenticated Supabase admin Edge
 * Function. This file deliberately contains no D1 route and no local config
 * store; the active dashboard uses admin-service.js directly.
 */
(function initAdminConfigService() {
  'use strict';

  async function invoke(action, payload = {}) {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client?.functions?.invoke) {
      throw new Error('Le service administrateur Supabase est indisponible.');
    }
    const { data, error } = await bridge.client.functions.invoke(
      'admin-method-control',
      { body: { action, ...payload } }
    );
    if (error || !data?.ok) {
      throw new Error(data?.error || error?.message || 'Commande administrateur refusée.');
    }
    window.dispatchEvent(new CustomEvent('cid:admin-config-updated'));
    window.dispatchEvent(new CustomEvent('cid:admin-access-updated', { detail: data }));
    return data;
  }

  function savePlan(plan = {}) {
    return invoke('save-access-plan', {
      slug: plan.slug,
      displayName: plan.display_name || plan.displayName,
      requiredStars: Number(plan.required_stars ?? plan.requiredStars),
      requiredTokens: Number(plan.required_tokens ?? plan.requiredTokens),
      regularTokens: Number(plan.regular_tokens ?? plan.regularTokens ?? plan.required_tokens ?? plan.requiredTokens),
      promotionEnabled: plan.promotion_enabled === true || plan.promotionEnabled === true,
      promotionLabel: plan.promotion_label || plan.promotionLabel || '',
      promotionEndsAt: plan.promotion_ends_at || plan.promotionEndsAt || '',
      unlockCurrency: plan.unlock_currency || plan.unlockCurrency,
      durationDays: Number(plan.duration_days ?? plan.durationDays),
      referralRewardStars: Number(plan.referral_reward_stars ?? plan.referralRewardStars),
      referralRewardTokens: Number(plan.referral_reward_tokens ?? plan.referralRewardTokens ?? 0),
      paymentMode: plan.payment_mode || plan.paymentMode,
      priceLabel: plan.price_label || plan.priceLabel,
      features: Array.isArray(plan.features) ? plan.features : [],
      enabled: plan.enabled !== false
    });
  }

  function deletePlan(slug) {
    return invoke('delete-access-plan', { slug });
  }

  function saveStarPrice(price = {}) {
    return invoke('save-star-price', {
      countryCode: price.country_code || price.countryCode,
      countryName: price.country_name || price.countryName,
      currencyCode: price.currency_code || price.currencyCode,
      currencySymbol: price.currency_symbol || price.currencySymbol,
      pricePerStar: Number(price.price_per_star ?? price.pricePerStar),
      enabled: price.enabled !== false
    });
  }

  function deleteStarPrice(countryCode) {
    return invoke('delete-star-price', { countryCode });
  }

  function saveTokenPrice(price = {}) {
    return invoke('save-token-price', {
      packId: price.pack_id || price.packId,
      name: price.name,
      quantity: Number(price.quantity),
      priceXof: Number(price.price_xof ?? price.priceXof),
      enabled: price.enabled !== false
    });
  }

  function deleteTokenPrice(packId) {
    return invoke('delete-token-price', { packId });
  }

  function savePayment(settings = {}) {
    return invoke('save-payment-settings', {
      paymentMode: settings.payment_mode || settings.paymentMode,
      onlineProvider: settings.online_provider || settings.onlineProvider,
      onlinePaymentLink: settings.online_payment_link || settings.onlinePaymentLink,
      physicalInstructions: settings.physical_instructions || settings.physicalInstructions,
      contactLabel: settings.contact_label || settings.contactLabel,
      manualEnabled: settings.manual_enabled !== false,
      currencyMode: settings.currency_mode || settings.currencyMode,
      contactChannel: settings.contact_channel || settings.contactChannel,
      whatsappNumber: settings.whatsapp_number || settings.whatsappNumber,
      chatLabel: settings.chat_label || settings.chatLabel
    });
  }

  function saveCommentRule(key, enabled) {
    return invoke('save-comment-rule', { key: String(key || '').trim(), enabled: enabled !== false });
  }

  function deleteCommentRule(key) {
    return invoke('delete-comment-rule', { key: String(key || '').trim() });
  }

  function saveLock(lock = {}) {
    return invoke('save-content-lock', lock);
  }

  function deleteLock(id) {
    return invoke('delete-content-lock', { id });
  }

  function unsupported(name) {
    return Promise.reject(new Error(`${name} n’est pas encore exposé par le schéma Supabase.`));
  }

  async function state() {
    const config = await window.cidSiteConfig?.load?.({ force: true });
    return {
      plans: config?.plansAll || [],
      starPrices: config?.starPrices || [],
      tokenPrices: config?.tokenPrices || [],
      paymentSettings: config?.paymentSettings || null,
      banners: config?.banners || [],
      grids: config?.grids || {},
      gridAssignments: config?.gridAssignments || [],
      commentRules: config?.commentRules || {},
      locks: config?.locks || []
    };
  }

  window.cidAdminConfig = Object.freeze({
    savePlan,
    deletePlan,
    saveStarPrice,
    deleteStarPrice,
    saveTokenPrice,
    deleteTokenPrice,
    savePayment,
    saveCommentRule,
    deleteCommentRule,
    saveLock,
    deleteLock,
    saveBanner: () => unsupported('Les bannières'),
    deleteBanner: () => unsupported('Les bannières'),
    saveGrid: () => unsupported('Les grilles'),
    state
  });
})();
