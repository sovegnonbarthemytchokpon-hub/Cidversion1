/*
 * Stable Croix interaction boundary.
 *
 * The Croix is a publication, not a draggable editor. The previous version
 * changed font sizes and positions according to the displayed digits (and
 * enlarged digits on yellow days), which made an identical layout move from
 * one draw to the next. Keep only the interaction lock and one fixed
 * coordinate plane here; colour and responsive sizing remain owned by the
 * canonical CSS/service.
 */
(function installStableCrossGeometry() {
  'use strict';

  const root = document.getElementById('redCross');
  if (!root) return;

  root.style.pointerEvents = 'auto';

  // Buttons keep their normal actions; published values and labels cannot be
  // dragged, selected or edited by long-press on mobile.
  root.querySelectorAll(
    '.cross-numbers .num, .termination, .term-paren, .term-title, ' +
    '#redCrossDate, .right-label, .redCrossFooter'
  ).forEach((element) => {
    element.style.pointerEvents = 'none';
    element.style.userSelect = 'none';
    element.style.touchAction = 'manipulation';
    element.style.cursor = 'default';
  });

  root.querySelectorAll('.cross-numbers .num').forEach((number) => {
    number.setAttribute('aria-hidden', 'true');
    number.setAttribute('role', 'img');
    number.setAttribute('contenteditable', 'false');
    number.addEventListener(
      'pointerdown',
      (event) => event.stopImmediatePropagation(),
      { capture: true }
    );
    number.addEventListener(
      'keydown',
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true }
    );
    number.addEventListener(
      'contextmenu',
      (event) => event.preventDefault(),
      { capture: true }
    );
    number.addEventListener(
      'dragstart',
      (event) => event.preventDefault(),
      { capture: true }
    );
  });

  /*
   * Use the same coordinates for every value. In particular, never inspect
   * textContent here: a 9 becoming a 0 must not move or resize the artwork.
   * The canonical stylesheet scales this 380px reference plane as a whole.
   */
  const positions = {
    n1: [34, 26],
    n2: [50, 38],
    n3: [66, 26],
    n4: [64, 50],
    n5: [66, 72],
    n6: [50, 64],
    n7: [34, 72],
    n8: [36, 50]
  };

  root.querySelectorAll('.cross-numbers .num').forEach((number, index) => {
    const key = Object.keys(positions).find((name) => (
      number.classList.contains(name)
    )) || `n${index + 1}`;
    const [left, top] = positions[key] || positions.n1;
    number.style.setProperty('left', `${left}%`, 'important');
    number.style.setProperty('top', `${top}%`, 'important');
    number.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
    number.style.setProperty('pointer-events', 'none', 'important');
    number.style.setProperty('user-select', 'none', 'important');
  });
})();
