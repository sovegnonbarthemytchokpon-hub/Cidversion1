/*
 * Keep the Croix composition proportional to its own reference square.
 * This uses ResizeObserver when available and a window-resize fallback for
 * older browsers. It does not change the cross content or its positions.
 */

(() => {
  const REFERENCE_SIZE = 380;
  const roots = ['redCross', 'redCrossClone']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (!roots.length) return;

  const syncGeometry = (root) => {
    const width = root.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;

    /*
     * Lock the live component to one square coordinate plane. The inline
     * important values are intentional: they protect the composition from
     * later orientation-specific rules that might set a different height.
     */
    const size = `${Math.round(width * 100) / 100}px`;
    if (root.style.height !== size) root.style.setProperty('height', size, 'important');
    if (root.style.minHeight !== size) root.style.setProperty('min-height', size, 'important');
    if (root.style.maxHeight !== size) root.style.setProperty('max-height', size, 'important');
    root.style.setProperty('aspect-ratio', '1 / 1', 'important');

    const svg = root.querySelector(':scope > svg');
    if (svg) {
      svg.style.setProperty('width', '100%', 'important');
      svg.style.setProperty('height', '100%', 'important');
      svg.style.setProperty('max-width', 'none', 'important');
      svg.style.setProperty('max-height', 'none', 'important');
      svg.style.setProperty('aspect-ratio', '1 / 1', 'important');
    }
  };

  const syncScale = (root) => {
    syncGeometry(root);
    const width = root.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    root.style.setProperty('--cross-scale', String(width / REFERENCE_SIZE));
  };

  const syncAll = () => roots.forEach(syncScale);

  syncAll();

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => syncScale(target));
    });
    roots.forEach((root) => observer.observe(root));
  } else {
    if ('MutationObserver' in window) {
      const observer = new MutationObserver(syncAll);
      roots.forEach((root) => observer.observe(root, {
        attributes: true,
        attributeFilter: ['style', 'class']
      }));
    }
    window.addEventListener('resize', syncAll, { passive: true });
    window.addEventListener('orientationchange', syncAll, { passive: true });
  }

})();
