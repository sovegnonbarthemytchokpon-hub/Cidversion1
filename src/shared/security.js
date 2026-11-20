/*
 * Global client-side protection shared by every view.
 *
 * This is only a user-interface guard: browser-side JavaScript can never
 * replace server-side authorization. No API secret is stored in this app;
 * sensitive operations must remain behind authenticated server routes.
 */
(() => {
  const blockedKey = (event) => {
    const key = String(event.key || '').toLowerCase();
    const blocked = key === 'f12' ||
      (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
      (event.metaKey && event.altKey && key === 'i');
    if (!blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener('keydown', blockedKey, true);
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  }, true);
})();
