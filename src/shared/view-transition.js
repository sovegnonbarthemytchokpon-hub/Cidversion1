/*
 * SPA view transition API.
 *
 * The application has one startup loader, removed after the shared shell and
 * data are ready. Showing another full-screen loader for every tab made
 * Accueil briefly reappear between sections and made the app feel like a
 * collection of separate pages. View changes are now synchronous and keep the
 * already-mounted shell visible; the public functions remain for older
 * controllers that still call them.
 */

function startViewTransition() {
  document.body.classList.remove('cid-view-transitioning');
}

function finishViewTransition() {
  const element = document.getElementById('cidViewTransition');
  if (!element) return;
  element.style.display = 'none';
  element.classList.remove('is-leaving');
  element.setAttribute('aria-hidden', 'true');
}

function runViewTransition(viewName, callback) {
  startViewTransition(viewName);
  try {
    return callback?.();
  } finally {
    finishViewTransition();
  }
}

window.cidStartViewTransition = startViewTransition;
window.cidFinishViewTransition = finishViewTransition;
window.cidRunViewTransition = runViewTransition;
