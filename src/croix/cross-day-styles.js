/*
 * Croix nationale visual memory.
 *
 * Programme dates are converted to a weekday before any Croix is painted.
 * Keeping this table in one module prevents Accueil, Historique and
 * Anticipé from carrying separate colour/design rules.
 */

export const CROSS_DAY_STYLES = Object.freeze({
  0: Object.freeze({
    day: 0,
    key: 'dimanche',
    label: 'Dimanche',
    color: '#FFD700',
    ink: '#000000',
    className: 'cross-style-dimanche'
  }),
  1: Object.freeze({
    day: 1,
    key: 'lundi',
    label: 'Lundi',
    color: '#1877F2',
    ink: '#FFFFFF',
    className: 'cross-style-lundi'
  }),
  2: Object.freeze({
    day: 2,
    key: 'mardi',
    label: 'Mardi',
    color: '#008000',
    ink: '#FFFFFF',
    className: 'cross-style-mardi'
  }),
  3: Object.freeze({
    day: 3,
    key: 'mercredi',
    label: 'Mercredi',
    color: '#6A0DAD',
    ink: '#FFFFFF',
    className: 'cross-style-mercredi'
  }),
  4: Object.freeze({
    day: 4,
    key: 'jeudi',
    label: 'Jeudi',
    color: '#808080',
    ink: '#FFFFFF',
    className: 'cross-style-jeudi'
  }),
  5: Object.freeze({
    day: 5,
    key: 'vendredi',
    label: 'Vendredi',
    color: '#FF0000',
    ink: '#FFFFFF',
    className: 'cross-style-vendredi'
  }),
  6: Object.freeze({
    day: 6,
    key: 'samedi',
    label: 'Samedi',
    color: '#800020',
    ink: '#FFFFFF',
    className: 'cross-style-samedi'
  })
});

export const CROSS_DAY_COLORS = Object.freeze(
  Object.fromEntries(
    Object.entries(CROSS_DAY_STYLES).map(([day, style]) => [day, style.color])
  )
);

export const CROSS_DAY_STYLE_CLASSES = Object.freeze(
  Object.values(CROSS_DAY_STYLES).map((style) => style.className)
);

export function crossDayStyleForIndex(day) {
  const index = Number(day);
  return CROSS_DAY_STYLES[
    Number.isInteger(index) && index >= 0 && index <= 6 ? index : 0
  ];
}

export function crossDayStyleForDate(value) {
  const date = value instanceof Date
    ? value
    : new Date(`${String(value || '').slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? crossDayStyleForIndex(0)
    : crossDayStyleForIndex(date.getUTCDay());
}

/*
 * Apply only the shared visual identity. The result/number renderer remains
 * responsible for the date-specific payload.
 */
export function applyCrossDayStyle(root, value) {
  if (!root) return crossDayStyleForDate(value);
  const style = crossDayStyleForDate(value);
  root.classList?.remove?.(...CROSS_DAY_STYLE_CLASSES);
  root.classList?.add?.(style.className);
  root.dataset.crossDay = String(style.day);
  root.dataset.crossDayKey = style.key;
  root.dataset.crossDayLabel = style.label;
  root.dataset.crossInk = style.ink === '#000000' ? 'dark' : 'light';
  root.style.setProperty('--cid-cross-color', style.color, 'important');
  root.style.setProperty('--cid-cross-ink', style.ink, 'important');
  root.style.setProperty('--redCross-bg', style.color, 'important');
  root.style.setProperty('background', style.color, 'important');
  return style;
}

window.cidCrossDayStyles = Object.freeze({
  styles: CROSS_DAY_STYLES,
  colors: CROSS_DAY_COLORS,
  forIndex: crossDayStyleForIndex,
  forDate: crossDayStyleForDate,
  apply: applyCrossDayStyle
});
