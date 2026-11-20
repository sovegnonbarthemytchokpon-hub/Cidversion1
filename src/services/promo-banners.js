/*
 * Rotating public banners managed by the administrator.
 */
(function initPromoBanners() {
  'use strict';

  let timer = 0;
  let index = 0;

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

  function validTarget(value) {
    const target = String(value || '').trim();
    return /^(?:\/|https?:\/\/)/i.test(target) ? target : '';
  }

  function render(access) {
    const selectedCountry = String(window.cidSmartCountry?.get?.() || 'Tous')
      .trim()
      .toLocaleLowerCase('fr-FR');
    const banners = (Array.isArray(access?.banners) ? access.banners : [])
      .filter((banner) => ['homepage', 'all'].includes(String(banner.placement || '')));
      const visibleBanners = banners.filter((banner) => {
        const target = String(banner.country_code || 'ALL').toUpperCase();
        if (target === 'ALL') return true;
        if (!selectedCountry || selectedCountry === 'tous') return false;
        const countryNames = {
          CI: ["côte d’ivoire", "côte d'ivoire", 'cote d ivoire'],
          BJ: ['bénin', 'benin'],
          NE: ['niger'],
          GH: ['ghana'],
          SN: ['sénégal', 'senegal'],
          TG: ['togo']
        };
        return (countryNames[target] || [target.toLocaleLowerCase('fr-FR')])
          .some((name) => selectedCountry.includes(name) || name.includes(selectedCountry));
      });
    let root = document.getElementById('cidPromoBannerCarousel');
    window.clearInterval(timer);
    timer = 0;
    if (!visibleBanners.length) {
      root?.remove();
      return;
    }
    if (!root) {
      root = document.createElement('aside');
      root.id = 'cidPromoBannerCarousel';
      root.className = 'cid-promo-banner-carousel';
      document.querySelector('.site-header')?.after(root);
    }
    index = Math.min(index, visibleBanners.length - 1);
    const banner = visibleBanners[index];
    const target = validTarget(banner.target_url);
    const feature = banner.feature_key
      ? `<span class="cid-promo-banner__feature">${escapeHtml(banner.feature_key.replace(/^tableaux-/, ''))}</span>`
      : '';
    const content = `
      <div class="cid-promo-banner__copy">
        <span class="cid-promo-banner__eyebrow">${escapeHtml(t('promo.discover', 'À découvrir'))}</span>
        <strong>${escapeHtml(localizedField(banner, 'title'))}</strong>
        ${feature}
        ${localizedField(banner, 'description')
          ? `<p>${escapeHtml(localizedField(banner, 'description'))}</p>` : ''}
        ${banner.key_value ? `<code>${escapeHtml(banner.key_value)}</code>` : ''}
        ${target && localizedField(banner, 'action_label')
          ? `<a href="${escapeHtml(target)}">${escapeHtml(localizedField(banner, 'action_label'))}</a>`
          : ''}
      </div>
      ${banner.image_url
        ? `<img src="${escapeHtml(banner.image_url)}" alt="" loading="lazy">`
        : ''}`;
    root.innerHTML = content;
    if (visibleBanners.length > 1) {
      timer = window.setInterval(() => {
        index = (index + 1) % visibleBanners.length;
        render(access);
      }, 6500);
    }
  }

  function renderOffersTable(root, access) {
    if (!root) return;
    const plans = (Array.isArray(access?.plans) ? access.plans : [])
      .filter((plan) => plan?.enabled !== false);
    root.innerHTML = `
      <div class="cid-offers-table__heading">
        <span>${escapeHtml(t('promo.publicCatalog', 'Catalogue public'))}</span>
        <strong>${escapeHtml(t('promo.availableOffers', 'Offres disponibles'))}</strong>
      </div>
      <div class="cid-offers-table__grid">
        ${plans.length ? plans.map((plan) => {
          const features = Array.isArray(plan.features) ? plan.features : [];
          const usesStars = plan.unlock_currency === 'stars';
          const currency = usesStars
            ? t('balance.starPlural', 'étoiles')
            : t('balance.tokenPlural', 'jetons');
          const price = Number(usesStars ? plan.required_stars : plan.required_tokens) || 0;
          const regular = Number(usesStars ? plan.required_stars : plan.regular_tokens) || price;
          const promo = plan.promotion_enabled === true && regular > price;
          return `
            <article class="cid-offer-card">
              <strong>${escapeHtml(localizedField(plan, 'display_name', plan.slug))}</strong>
              <span>${escapeHtml(features.map((key) => String(key).replace(/^tableaux-/, '')).join(' · '))}</span>
              <div>
                ${promo ? `<s>${regular.toLocaleString(uiLocale())} ${currency}</s>` : ''}
                <b>${price.toLocaleString(uiLocale())} ${currency}</b>
              </div>
              <small>${Number(plan.duration_days) || 30} ${escapeHtml(t('promo.days', 'jours'))}</small>
            </article>`;
        }).join('') : `<p class="cid-offers-table__empty">${escapeHtml(t('promo.noOffers', 'Aucune offre disponible pour le moment.'))}</p>`}
      </div>`;
  }

  function announcement(access) {
    const selectedCountry = String(window.cidSmartCountry?.get?.() || 'Tous')
      .trim()
      .toLocaleLowerCase('fr-FR');
    const banners = (Array.isArray(access?.banners) ? access.banners : [])
      .filter((banner) => ['homepage', 'all'].includes(String(banner.placement || '')));
    const latest = banners.find((banner) => {
      const target = String(banner.country_code || 'ALL').toUpperCase();
      if (target === 'ALL') return true;
      if (!selectedCountry || selectedCountry === 'tous') return false;
      const names = {
        CI: ["côte d’ivoire", "côte d'ivoire", 'cote d ivoire'],
        BJ: ['bénin', 'benin'],
        NE: ['niger'],
        GH: ['ghana'],
        SN: ['sénégal', 'senegal'],
        TG: ['togo']
      };
      return (names[target] || [target.toLocaleLowerCase('fr-FR')])
        .some((name) => selectedCountry.includes(name) || name.includes(selectedCountry));
    });
    if (!latest?.id) return;
    const key = `cid-promo-seen:${latest.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch (_) {}
    const toast = document.createElement('aside');
    toast.className = 'cid-offer-announcement';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <span class="cid-offer-announcement__spark" aria-hidden="true">✦</span>
      <div><strong>${escapeHtml(t('promo.offerAvailableToday', 'Offre disponible aujourd’hui'))}</strong><span>${escapeHtml(localizedField(latest, 'title'))}</span></div>
      <button type="button">${escapeHtml(t('promo.viewOffers', 'Voir les offres'))}</button>`;
    document.body.appendChild(toast);
    toast.querySelector('button')?.addEventListener('click', () => {
      toast.remove();
      window.showOffersView?.();
    });
    window.setTimeout(() => toast.remove(), 9000);
  }

  window.cidRenderOffersTable = (root) => {
    window.cidSiteConfig?.load?.().then((access) => renderOffersTable(root, access)).catch(() => {});
  };

  function load() {
    window.cidSiteConfig?.load?.().then((access) => {
      render(access);
      announcement(access);
    }).catch(() => {});
  }

  window.addEventListener('cid:site-config-loaded', (event) => {
    render(event.detail);
    announcement(event.detail);
  });
  window.addEventListener('cid:admin-config-updated', load);
  window.addEventListener('cid:country-change', load);
  window.addEventListener('cid:language-change', load);
  load();
})();
