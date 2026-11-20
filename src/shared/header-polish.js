/*
 * Keep the header glass state in sync with the app's actual scroll surface.
 * The main app uses #results instead of document scrolling, while a few
 * dedicated views expose their own scroll container.
 */
(function initAdaptiveHeader() {
  function bind() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    const surfaces = [
      document.querySelector('#results'),
      document.querySelector('#tableauxViewContainer'),
      document.querySelector('#categoriesView'),
      document.querySelector('#croixViewContainer')
    ].filter(Boolean);

    function updateHeaderState(event) {
      const scrollTop = event && event.currentTarget !== window
        ? event.currentTarget.scrollTop
        : Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            ...surfaces.map((surface) => surface.scrollTop || 0)
          );

      header.classList.toggle('is-scrolled', scrollTop > 4);
    }

    surfaces.forEach((surface) => {
      surface.addEventListener('scroll', updateHeaderState, { passive: true });
    });
    window.addEventListener('scroll', updateHeaderState, { passive: true });
    updateHeaderState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
