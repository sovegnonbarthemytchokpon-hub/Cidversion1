/*
 * Public social/contact links.
 *
 * The administrator owns the values through payment_settings.social_links
 * and the public subscription-access catalogue. No social URL is hardcoded
 * in the public page.
 */
(function initPublicSocialLinks() {
  'use strict';

  function clean(value) {
    return String(value ?? '').trim();
  }
  const t = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );

  function safeUrl(value) {
    try {
      const url = new URL(clean(value));
      return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
    } catch (_) {
      return '';
    }
  }

  function phoneUrl(value, type = 'tel') {
    const phone = clean(value).replace(/[^\d+]/g, '');
    if (!phone) return '';
    return type === 'whatsapp'
      ? `https://wa.me/${phone.replace(/^\+/, '')}`
      : `tel:${phone}`;
  }

  function render(panel) {
    if (!panel) return;
    const settings = window.cidSiteConfig?.state?.()?.paymentSettings || {};
    const links = Array.isArray(settings.social_links)
      ? settings.social_links
        .map((item) => ({
          name: clean(item?.name),
          url: safeUrl(item?.url)
        }))
        .filter((item) => item.name && item.url)
      : [];

    panel.replaceChildren();
    const heading = document.createElement('p');
    heading.className = 'categories-social-heading';
    heading.textContent = t(
      'social.heading',
      'Retrouvez Cidmap sur les réseaux et contactez l’équipe.'
    );
    panel.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'categories-social-links';
    links.forEach((item) => {
      const anchor = document.createElement('a');
      anchor.href = item.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = item.name;
      list.appendChild(anchor);
    });

    const contactNumber = clean(settings.whatsapp_number);
    const contactType = clean(settings.contact_channel).toLowerCase();
    const contactHref = phoneUrl(
      contactNumber,
      contactType === 'whatsapp' ? 'whatsapp' : 'tel'
    );
    if (contactHref) {
      const anchor = document.createElement('a');
      anchor.href = contactHref;
      if (contactType === 'whatsapp') {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
      anchor.textContent = clean(settings.contact_label)
        || (contactType === 'whatsapp' ? 'WhatsApp' : t(
          'social.contact',
          'Contacter l’équipe'
        ));
      list.appendChild(anchor);
    }

    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'categories-social-empty';
      empty.textContent = t(
        'social.empty',
        'Les liens publics seront ajoutés par l’administrateur.'
      );
      panel.appendChild(empty);
      return;
    }
    panel.appendChild(list);
  }

  window.cidRenderSocialLinks = render;
  window.addEventListener('cid:site-config-loaded', () => {
    render(document.getElementById('categoriesSocialPanel'));
  });
  window.addEventListener('cid:admin-config-updated', () => {
    render(document.getElementById('categoriesSocialPanel'));
  });
  window.addEventListener('cid:language-change', () => {
    render(document.getElementById('categoriesSocialPanel'));
  });
})();
