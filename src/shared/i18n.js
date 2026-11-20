/*
 * Compatibility entry point.
 *
 * Older modules still load this file, but language state belongs exclusively
 * to /src/shared/translation.js. Keeping this adapter avoids a breaking
 * change for legacy callers and deliberately creates no second selector,
 * catalogue, mutation observer or localStorage preference.
 */
(function keepLegacyI18nCompatibility() {
  const sync = () => {
    const runtime = window.cidTranslation;
    if (!runtime) return;
    window.cidI18n = {
      translatePage: (locale) => window.changeLanguage?.(locale || runtime.current()),
      translate: (key, locale) => {
        if (locale && locale !== runtime.current() && locale === 'en') {
          return runtime.catalog()?.[String(key)] || String(key);
        }
        return runtime.t(key, key);
      },
      availableLocales: runtime.available(),
      currentLocale: runtime.current
    };
    window.i18n = window.cidI18n;
  };
  sync();
  window.addEventListener('cid:language-change', sync);
  window.addEventListener('cid:site-config-loaded', sync);
})();
