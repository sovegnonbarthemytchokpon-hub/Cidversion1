/*
 * Locale-safe date fitting for the canonical Croix.
 *
 * The Croix is a protected square composition. A translated date may be
 * longer or shorter than the French reference, so only its typography is
 * allowed to adapt. The date never changes the root dimensions, SVG
 * coordinates, numbers, colours, or calculation payload.
 */
(() => {
  'use strict';

  const REFERENCE_SIZE = 380;
  const MIN_FONT_SIZE = 8;
  const dateSelector = '[id="redCrossDate"], [id="redCrossDate-clone"]';
  const measurementCanvas = document.createElement('canvas');
  const measurementContext = measurementCanvas.getContext('2d');
  let scheduledFrame = 0;
  const observedRoots = new WeakSet();

  function roots() {
    return Array.from(document.querySelectorAll('#redCross, #redCrossClone'));
  }

  function dateElement(root) {
    return root?.querySelector(dateSelector) || null;
  }

  function insetInPixels(root, width) {
    const value = getComputedStyle(root)
      .getPropertyValue('--cross-date-inset')
      .trim();
    if (value.endsWith('%')) {
      const percentage = Number.parseFloat(value);
      return Number.isFinite(percentage) ? width * percentage / 100 : width * 0.07;
    }
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : width * 0.07;
  }

  function letterSpacingInPixels(value) {
    if (!value || value === 'normal') return 0;
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : 0;
  }

  function measuredWidth(text, fontSize, style) {
    if (!measurementContext || !text) return 0;
    const fontStyle = style.fontStyle || 'normal';
    const fontVariant = style.fontVariant || 'normal';
    const fontWeight = style.fontWeight || '900';
    const fontFamily = style.fontFamily || 'sans-serif';
    measurementContext.font = [
      fontStyle,
      fontVariant,
      fontWeight,
      `${fontSize}px`,
      fontFamily
    ].join(' ');
    const width = measurementContext.measureText(text).width;
    const spacing = letterSpacingInPixels(style.letterSpacing);
    return width + Math.max(0, text.length - 1) * spacing;
  }

  function fitDate(root) {
    const date = dateElement(root);
    if (!date) return;

    const width = root.getBoundingClientRect().width;
    const text = String(date.textContent || '').trim();
    if (!Number.isFinite(width) || width <= 0 || !text) return;

    const style = getComputedStyle(date);
    const scale = width / REFERENCE_SIZE;
    const currentFontSize = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(currentFontSize) || currentFontSize <= 0) return;

    // Store the un-fitted size in the 380px reference coordinate plane. This
    // prevents a previous language's fitted size from becoming the new
    // baseline after a resize or a later language change.
    if (!date.dataset.crossDateBaseSize) {
      date.dataset.crossDateBaseSize = String(
        Math.max(MIN_FONT_SIZE, currentFontSize / Math.max(scale, 0.01))
      );
    }

    const baseSize = Number.parseFloat(date.dataset.crossDateBaseSize);
    if (!Number.isFinite(baseSize) || baseSize <= 0) return;

    const inset = insetInPixels(root, width);
    const availableWidth = Math.max(1, width - (inset * 2));
    const maximumSize = Math.max(MIN_FONT_SIZE, baseSize * scale);
    let fittedSize = maximumSize;
    const initialWidth = measuredWidth(text, fittedSize, style);

    if (initialWidth > availableWidth) {
      // Text width is effectively linear with font size, so this first
      // estimate is accurate and the second pass covers font rounding.
      fittedSize *= availableWidth / initialWidth;
      const secondWidth = measuredWidth(text, fittedSize, style);
      if (secondWidth > availableWidth) {
        fittedSize *= availableWidth / secondWidth;
      }
    }

    fittedSize = Math.max(MIN_FONT_SIZE, Math.min(maximumSize, fittedSize * 0.985));
    date.style.setProperty('font-size', `${fittedSize}px`, 'important');
    date.dataset.crossDateLocale = document.documentElement.lang || '';
  }

  function fitAll() {
    scheduledFrame = 0;
    roots().forEach((root) => {
      fitDate(root);
      if (observedRoots.has(root)) return;
      observedRoots.add(root);
      if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(() => schedule());
        observer.observe(root);
      }
    });
  }

  function schedule() {
    if (scheduledFrame) return;
    const run = () => fitAll();
    scheduledFrame = 'requestAnimationFrame' in window
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 0);
  }

  // New historical clones and dedicated-view mounts are inserted dynamically.
  // Watching only child additions avoids reacting to the inline font-size
  // writes made by this fitter itself.
  if (document.body && 'MutationObserver' in window) {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('cid:language-change', () => {
    // The translation service and the Croix service update text in the same
    // event cycle. Three passes cover the immediate DOM update and the
    // official cross refresh without requiring a full page reload.
    schedule();
    window.setTimeout(schedule, 0);
    window.setTimeout(schedule, 80);
  });

  if (document.fonts?.ready) {
    document.fonts.ready.then(schedule).catch(() => {});
  }

  schedule();
})();
