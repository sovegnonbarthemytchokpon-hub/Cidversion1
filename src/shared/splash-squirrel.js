/*
 * Cidmap startup mark.
 *
 * The provided squirrel illustration is the shared site icon. The surrounding
 * chrome still follows the official Croix nationale colour.
 */
(() => {
  'use strict';

  const FALLBACK = '#e30613';
  let lastAppliedColor = '';

  function validColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  }

  function contrastInk(hex) {
    const value = String(hex).replace('#', '');
    const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
    const luminance = channels
      .map((channel) => channel <= .03928
        ? channel / 12.92
        : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance > .48 ? '#132342' : '#ffffff';
  }

  function squirrelHueRotation(hex) {
    const value = String(hex).replace('#', '');
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return '0deg';
    const delta = max - min;
    let hue = 0;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    // The supplied red/white variant is based on a red near 0°.
    const rotation = ((hue + 180) % 360) - 180;
    return `${rotation.toFixed(2)}deg`;
  }

  function currentColor() {
    const rootStyle = getComputedStyle(document.documentElement);
    // The daily illustration controller is the canonical source for the
    // current programme day. Prefer it over a stale cross snapshot that may
    // still be present while the new day's data is loading.
    return validColor(rootStyle.getPropertyValue('--cid-national-color'))
      || validColor(rootStyle.getPropertyValue('--daily-illustration-color'))
      || validColor(rootStyle.getPropertyValue('--redCross-bg'))
      || FALLBACK;
  }

  function apply() {
    const color = currentColor();
    if (color === lastAppliedColor) return;
    lastAppliedColor = color;
    const ink = contrastInk(color);
    document.documentElement.style.setProperty('--cid-squirrel-color', color);
    document.documentElement.style.setProperty('--cid-squirrel-ink', ink);
    document.documentElement.style.setProperty('--cid-squirrel-hue', squirrelHueRotation(color));
    document.documentElement.style.setProperty('--cid-header-accent', color);
    document.documentElement.style.setProperty('--cid-header-ink', ink);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = color;
    // Keep the provided squirrel illustration as the single site identity.
    // The surrounding chrome still follows the Croix nationale day colour.
    const avatar = '/src/shared/images/squirrel-croix-512.png?squirrel-croix-v1';
    window.__cidBrandAvatarSrc = avatar;
    document.querySelectorAll('[data-cid-brand-avatar]').forEach((image) => {
      image.src = avatar;
    });
    const favicon = document.getElementById('cidDynamicFavicon');
    if (favicon) favicon.href = avatar;
  }

  window.addEventListener('cidgroup:illustrations-updated', apply);
  window.addEventListener('cid:brand-avatar-request', apply);
  const colorObserver = new MutationObserver(apply);
  colorObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style']
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
