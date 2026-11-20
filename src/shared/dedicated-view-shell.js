/*
 * Single active-view shell.
 *
 * The legacy page keeps several view hosts in the DOM for compatibility.
 * This module gives them one owner at a time while the global header and
 * bottom navigation remain mounted as persistent application chrome.
 *
 * Section navigation is rendered inside the global 50px header. Keeping the
 * back affordance in that single shell prevents a second header from stealing
 * vertical reading space on mobile.
 */

(() => {
  let backAction = null;
  let backBusy = false;

  function getSectionContext() {
    return {
      context: document.getElementById('cidSectionContext'),
      title: document.getElementById('cidSectionTitle'),
      back: document.getElementById('cidSectionBack')
    };
  }

  function bindBackButton() {
    const { back } = getSectionContext();
    if (!back || back.dataset.cidBound === 'true') return;
    back.dataset.cidBound = 'true';
    back.classList.add('cid-back-button');
    back.setAttribute('data-cid-back-button', 'true');
    back.type = 'button';
    back.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateBack();
    });
  }

  function navigateBack() {
    if (backBusy) return;
    backBusy = true;
    const action = typeof backAction === 'function'
      ? backAction
      : () => window.showCategoriesView?.();
    try {
      // Invoke the route transition in the same click task. In particular,
      // do not wait for an entitlement refresh before giving touch feedback
      // or changing the visible view.
      const result = action();
      Promise.resolve(result).finally(() => {
        window.setTimeout(() => { backBusy = false; }, 0);
      });
    } catch (error) {
      backBusy = false;
      console.warn('Dedicated view back navigation failed', error);
    }
  }

  function show({ id, title, onBack } = {}) {
    const safeId = String(id || '').trim().toLowerCase();
    if (!safeId) return;
    const sectionTitle = String(title || '');
    const { context, title: titleElement, back } = getSectionContext();
    bindBackButton();
    if (titleElement) titleElement.textContent = sectionTitle;
    if (context) {
      context.hidden = false;
      context.setAttribute('aria-hidden', 'false');
    }
    if (back) {
      back.setAttribute('aria-label', `Retour depuis ${sectionTitle || 'cette section'}`);
      back.setAttribute('title', 'Retour');
    }
    backAction = typeof onBack === 'function' ? onBack : () => window.showCategoriesView?.();
    backBusy = false;
    document.body.dataset.cidDedicatedView = safeId;
    document.body.classList.add('cid-dedicated-view-active');
    document.body.classList.remove(
      'accueil-active',
      'categories-active',
      'archive-active'
    );
  }

  function hide() {
    delete document.body.dataset.cidDedicatedView;
    document.body.classList.remove('cid-dedicated-view-active', 'matrix-level-one');
    backAction = null;
    const { context, title } = getSectionContext();
    if (context) {
      context.hidden = true;
      context.setAttribute('aria-hidden', 'true');
    }
    if (title) title.textContent = '';
  }

  window.cidNavigateBack = navigateBack;
  window.cidShowDedicatedView = show;
  window.cidHideDedicatedView = hide;
})();
