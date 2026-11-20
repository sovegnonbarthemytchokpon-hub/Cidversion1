/*
 * Dedicated Catégories view.
 *
 * DISPLAY FREEZE v1: keep the category wrapper and option flow stable. The
 * shared card/container mould is enforced by the single stylesheet /src/styles/app.css.
 *
 * The old implementation rendered the category choices as a fixed blue
 * submenu over the Accueil cross. This controller keeps the shell mounted but
 * swaps the content view in place, so Accueil, Catégories and Matrice never
 * occupy the screen at the same time.
 */

(() => {
  const normalize = (value) => String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const get = (id) => document.getElementById(id);
  let activeTab = 'accueil';
  let navigationEpoch = 0;
  const BOTTOM_NAV_TABS = Object.freeze({
    categoryAccueilButton: 'accueil',
    anticipationBtn: 'anticipe',
    categoryCategoriesButton: 'categories',
    tableauxBtn: 'tableaux',
    profileBtn: 'compte'
  });

  /*
   * There is one source of truth for the bottom navigation.  Every update
   * first clears the whole bar and then applies the state to exactly one
   * matching button.  In particular, do not use truthy/falsy checks here:
   * `activeTab === tab` is intentionally the only active-state condition.
   */
  const setBottomNavActiveTab = (nextTab) => {
    const requestedTab = String(nextTab || '').trim().toLocaleLowerCase('fr-FR');
    activeTab = Object.values(BOTTOM_NAV_TABS).includes(requestedTab)
      ? requestedTab
      : 'accueil';
    window.__activeTab = activeTab;

    document.querySelectorAll('.category-bar .category-item').forEach((item) => {
      const tab = BOTTOM_NAV_TABS[item.id] || null;
      const isActive = activeTab === tab;
      item.classList.toggle('active', isActive);
      // Legacy CSS also treats aria-pressed="true" as active. Normalize it
      // here so a previous controller cannot leave a second button lit.
      item.setAttribute('aria-pressed', String(isActive));
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  };

  const startTransition = (label) => {
    try { window.cidStartViewTransition?.(label); } catch (_) {}
  };

  const finishTransition = () => {
    try { window.cidFinishViewTransition?.(); } catch (_) {}
  };

  /*
   * Entitlement checks can require a network round-trip. Start them in the
   * same click task as the route transition so the user gets immediate visual
   * feedback. requireAccess still owns the denial flow (Compte / rewards);
   * the epoch guard prevents an older request from affecting a newer route.
   */
  const beginFeatureGate = (featureKey, requestEpoch) => {
    let check;
    try {
      check = window.cidFeatureAccess?.require?.(featureKey, {
        isCurrent: () => requestEpoch === navigationEpoch
      });
    } catch (_) {
      return;
    }
    Promise.resolve(check).catch(() => {}).then((allowed) => {
      if (allowed !== false || requestEpoch !== navigationEpoch) return;
      // requireAccess schedules the protected redirect itself. Replace the
      // optimistic route first so Back from Compte returns to Catégories,
      // rather than reopening a view the visitor cannot access.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'categories');
        url.searchParams.delete('date');
        window.history.replaceState(
          { ...(window.history.state || {}), view: 'categories' },
          '',
          url.toString()
        );
        rememberRoute('categories');
      } catch (_) {}
    });
  };

  const rememberRoute = (section, options = {}) => {
    try { window.cidRoutePersistence?.remember(section, options); } catch (_) {}
  };

  const releaseInitialCategoryLock = () => {
    document.documentElement.removeAttribute('data-cid-initial-section');
  };

  const resetNavigationState = () => {
    // Release every document-level lock before mounting the next route. This
    // is intentionally done for Accueil as well: returning from Compte must
    // never inherit a modal or keyboard lock from the previous surface.
    window.cidResetScrollLock?.({ closeModals: true, resetSurfaces: true });
    // Notifications are a route layered above the persistent shell. Close
    // only that layer before changing sections; the notification controller
    // must not call showHomeView() recursively while another route is being
    // mounted.
    window.cidNotifications?.close?.({ fromHistory: true });
    window.cidCloseBalancePanel?.({ fromHistory: true });
    window.hideAnticipationView?.();
    // Account is a dedicated route. Unmount it before any other section becomes
    // active so the previous page cannot keep listeners/state alive.
    window.cidLeaveProfileView?.();
    window.rejectedController?.leave?.();
    // Invalidate the legacy inline renderer as soon as the route changes.
    // Its fetch is intentionally asynchronous, but a late response must not
    // repaint Boules rejetées after the user has already tapped Back.
    window.__cidRejectedInlineEpoch = 0;
    window.hideMatriceView?.();
    window.hideTableauxView?.();
    window.cidSetAccountTab?.(null);
    try { window.toggleArchive?.(false); } catch (_) {}

    document.querySelectorAll('.modal-overlay.open, .modal.open').forEach((modal) => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[aria-expanded="true"]').forEach((element) => {
      element.setAttribute('aria-expanded', 'false');
    });

    // The shell uses #results and dedicated hosts as scroll surfaces. Reset
    // all of them together so no previous section position leaks through.
    window.scrollTo(0, 0);
    document.querySelectorAll(
      'main, #results, #categoriesView, #tableauxViewContainer, ' +
      '#profileViewContainer, #croixViewContainer, #matrixCalculatorPanel, ' +
      '#anticipationViewContainer, #resultatAideViewContainer, ' +
      '#virtualAssistantViewContainer, #historyViewContainer, ' +
      '#globalStatisticsViewContainer'
    ).forEach((surface) => {
      surface.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    });
    window.cidResetScrollLock?.({ resetSurfaces: false });
  };

  const setPanel = (id, display, hidden = display === 'none') => {
    const element = get(id);
    if (!element) return;
    element.style.display = display;
    // Some dedicated views (notably Tableaux) use the boolean `hidden`
    // property in addition to an inline display value.  Restoring only the
    // latter leaves the element invisible after returning to Accueil.
    element.hidden = hidden;
    element.setAttribute('aria-hidden', String(hidden));
  };

  const pushViewState = (view) => {
    const url = new URL(window.location.href);
    if (view === 'accueil') url.searchParams.set('section', 'accueil');
    if (view === 'categories') url.searchParams.set('section', 'categories');
    if (view === 'calculator') url.searchParams.set('section', 'calculator');
    history.pushState({ view }, '', url.toString());
  };

  const ensureStyles = () => {
    if (get('categoriesViewStyles')) return;
    const style = document.createElement('style');
    style.id = 'categoriesViewStyles';
    style.textContent = `
      #categoriesView[hidden] { display:none !important; }
      .categories-view {
        min-height:100%;
        width:100%;
        box-sizing:border-box;
        display:block;
        padding:0;
        background:var(--cid-dedicated-bg, #f6f8fb);
      }
      .categories-view-inner {
        width:100%;
        margin:0 auto;
        display:flex;
        flex-direction:column;
        align-items:stretch;
        gap:0;
        padding-top:16px;
      }
      .categories-view-header {
        display:none;
      }
      .categories-view-header h1 {
        display:none !important;
        margin:0;
      }
      .categories-option {
        border:0;
        border-radius:12px;
        font:inherit;
        font-weight:800;
        cursor:pointer;
      }
      .categories-grid {
        width:100%;
        display:flex;
        flex-wrap:wrap;
        align-items:flex-start;
        justify-content:flex-start;
        gap:10px;
      }
      .categories-option {
        min-height:56px;
        width:max-content;
        max-width:100%;
        padding:14px 18px;
        color:#0A1840;
        background:#fff;
        border:1px solid rgba(9,98,214,.16);
        box-shadow:none;
        transition:border-color 150ms ease, background 150ms ease;
      }
      .categories-option:hover,
      .categories-option:focus-visible {
        border-color:#0962D6;
        background:#f2f7ff;
        outline:none;
      }
      .categories-social-panel {
        display:flex;
        flex-wrap:wrap;
        justify-content:flex-start;
        gap:10px;
        width:100%;
        margin-top:16px;
      }
      .categories-social-panel[hidden] { display:none; }
      .categories-social-heading {
        flex-basis:100%;
        margin:0;
        color:#61708d;
        font-size:.9rem;
      }
      .categories-social-links {
        display:flex;
        flex-wrap:wrap;
        gap:10px;
      }
      .categories-social-panel a {
        padding:9px 12px;
        border-radius:999px;
        color:#0962D6;
        background:#eef4ff;
        text-decoration:none;
        font-weight:700;
      }
      .categories-social-empty {
        flex-basis:100%;
        margin:0;
        color:#61708d;
        font-size:.85rem;
      }
      @media (max-width:520px) {
        .categories-view { min-height:100%; padding:0; }
        .categories-grid { gap:10px; }
        .categories-option { padding-inline:15px; }
      }`;
    document.head.appendChild(style);
  };

  const clearActiveState = () => {
    document.querySelectorAll('.category-bar .category-item.active, .plant-btn.active')
      .forEach((item) => {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
        if (item.closest('.category-bar')) item.setAttribute('aria-pressed', 'false');
      });
  };

  const markActive = (label) => {
    const expected = normalize(label);
    document.querySelectorAll('.category-bar .category-item').forEach((item) => {
      const isAccueil = expected === 'accueil' && item.id === 'categoryAccueilButton';
      if (isAccueil || normalize(item.textContent) === expected) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      }
    });
  };

  const hideContentViews = () => {
    resetNavigationState();
    document.body.classList.remove('croix-active');
    const categoriesView = get('categoriesView');
    if (categoriesView) {
      categoriesView.hidden = true;
      categoriesView.style.display = 'none';
    }
    get('categoriesSocialPanel')?.setAttribute('hidden', '');
    setPanel('topBanner', 'none');
    setPanel('redCross', 'none', true);
    setPanel('countryButtons', 'none');
    setPanel('results', 'none');
    setPanel('tableauxViewContainer', 'none');
    setPanel('croixViewContainer', 'none');
    setPanel('matrixCalculatorPanel', 'none');
    setPanel('categoriesOffersPanel', 'none', true);
    setPanel('categoriesResultatPanel', 'none', true);
    setPanel('categoriesVirtualPanel', 'none', true);
    setPanel('resultatAideViewContainer', 'none', true);
    setPanel('globalStatisticsViewContainer', 'none', true);
    setPanel('historyViewContainer', 'none', true);
    setPanel('virtualAssistantViewContainer', 'none', true);
    setPanel('anticipationViewContainer', 'none');
    ['currentDateTime', 'nextAvailableTime', 'nextDay', 'drawNumber'].forEach((id) => {
      const element = get(id);
      if (element) element.style.display = 'none';
    });
    const heading = document.querySelector('body > h1, main h1');
    if (heading) heading.style.display = 'none';
    try {
      if (typeof window.toggleArchive === 'function') window.toggleArchive(false);
    } catch (error) {
      console.warn('Unable to close archive while changing view', error);
    }
  };

  const showHomeView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Accueil');
    window.cidHideDedicatedView?.();
    releaseInitialCategoryLock();
    setBottomNavActiveTab('accueil');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    markActive('accueil');
    document.body.classList.remove('categories-active', 'calculator-active', 'rejected-active', 'matrice-active', 'archive-active', 'tableaux-active', 'anticipation-active');
    document.body.classList.add('accueil-active');
    window.__currentCategory = 'accueil';
    // A date selected in Historique belongs only to the dedicated Croix
    // route. Clear it before the home feed is restored so the illustration
    // catalogue and the official data loader cannot keep painting the
    // historical image on Accueil.
    if (window.cidProgrammeState) {
      window.cidProgrammeState.selectedDate = null;
    }
    window.__cidActiveProgrammeDate = '';
    window.__cidRequestedCroixArchiveDate = '';
    window.cidDailyIllustrations?.applyDailyIllustrations?.();
    // hideContentViews() intentionally blanks every content surface before a
    // route transition. Restore every home surface explicitly: Tableaux
    // marks these nodes with both `display:none` and `hidden=true`, and
    // restoring only the style would still leave a white/empty Accueil.
    setPanel('topBanner', 'flex', false);
    setPanel('results', '', false);
    setPanel('redCross', 'flex', false);
    // Account navigation can hide/remove the feed while authentication
    // finishes. Notify feed-owned components after the home surface is
    // visible again so they can remount without regenerating their data.
    window.dispatchEvent(new CustomEvent('cid:home-view-restored'));
    rememberRoute('accueil');
    if (updateHistory) pushViewState('accueil');
    finishTransition();
  };

  const showCategoriesView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Catégories');
    releaseInitialCategoryLock();
    window.cidShowDedicatedView?.({
      id: 'categories',
      title: 'Catégories',
      onBack: () => window.showHomeView?.()
    });
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    hideContentViews();
    clearActiveState();
    markActive('catégories');
    document.body.classList.remove('accueil-active', 'calculator-active', 'rejected-active', 'matrice-active', 'archive-active', 'tableaux-active', 'anticipation-active');
    document.body.classList.add('categories-active');
    window.__currentCategory = 'categories';

    const categoriesView = get('categoriesView');
    if (categoriesView) {
      categoriesView.hidden = false;
      categoriesView.style.display = 'flex';
      categoriesView.setAttribute('aria-hidden', 'false');
      // This is a fixed shell surface. `scrollIntoView()` would ask Safari to
      // scroll the document root as well, which can move the global header
      // during a route change. Reset only the surface that owns the view.
      categoriesView.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    }
    const categoriesGrid = document.querySelector('#categoriesView .categories-grid');
    if (categoriesGrid) {
      categoriesGrid.hidden = false;
      categoriesGrid.removeAttribute('aria-hidden');
    }
    rememberRoute('categories');
    if (updateHistory) pushViewState('categories');
    finishTransition();
  };

  const showCroixView = ({ updateHistory = true, date = '' } = {}) => {
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
      ? String(date).slice(0, 10)
      : '';
    const requestEpoch = ++navigationEpoch;
    beginFeatureGate('croix', requestEpoch);
    startTransition('Croix nationale');
    window.cidShowDedicatedView?.({
      id: 'croix',
      title: 'Croix nationale',
      onBack: () => window.showCategoriesView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    markActive('croix nationale');
    document.body.classList.remove('categories-active', 'accueil-active', 'calculator-active', 'rejected-active', 'matrice-active', 'tableaux-active', 'anticipation-active');
    document.body.classList.add('croix-active');
    // The global scroll guard defaults to vertical gestures. Croix contains a
    // nested horizontal archive, so refresh the document gesture contract
    // after the route class is applied.
    window.cidResetScrollLock?.({ resetSurfaces: false });
    // Remove the complete home publication stack before mounting the
    // dedicated surface. This is synchronous and idempotent, so an observer
    // cannot leave an old card underneath the seven-day archive.
    window.cidUnmountHomeFeed?.();
    // A future date belongs only to Anticipé. Do not carry a date selection
    // from that route into the normal Croix publication.
    if (window.cidProgrammeState) {
      window.cidProgrammeState.selectedDate = requestedDate || null;
    }
    window.__cidActiveProgrammeDate = requestedDate || '';
    window.__cidRequestedCroixArchiveDate = requestedDate || '';
    window.__currentCategory = 'croix';
    // Apply the weekday identity synchronously. The database request below
    // only fills the date-specific numbers and termination afterward.
    if (requestedDate) {
      window.cidCrossDayStyles?.apply?.(get('redCross'), requestedDate);
    }
    // Rebind the configured illustration to the requested programme date
    // before the canonical Croix node is moved into the dedicated card.
    window.cidDailyIllustrations?.applyDailyIllustrations?.();
    setPanel('croixViewContainer', 'block', false);
    setPanel('redCross', 'flex', false);
    // Mount the dedicated Croix shell first. The selected publication slot is
    // created by the `cid:croix-view-show` listener; moving the official
    // component before dispatch used to find no slot and left only the
    // nine-day history rail visible.
    window.dispatchEvent(new CustomEvent('cid:croix-view-show'));
    const cross = get('redCross');
    const crossSlot = get('croixViewCurrentCross');
    if (cross && crossSlot && cross.parentNode !== crossSlot) crossSlot.appendChild(cross);
    if (requestedDate && typeof window.updateRedCrossForDate === 'function') {
      Promise.resolve(window.updateRedCrossForDate(requestedDate)).catch((error) => {
        console.warn('Impossible de charger la Croix pour la date sélectionnée.', error);
      });
    }
    rememberRoute('croix');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'croix');
      if (requestedDate) url.searchParams.set('date', requestedDate);
      else url.searchParams.delete('date');
      history.pushState({ view: 'croix', date: requestedDate || null }, '', url.toString());
    }
    finishTransition();
  };

  const showMatriceView = ({ updateHistory = true, date = '' } = {}) => {
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
      ? String(date).slice(0, 10)
      : '';
    const requestEpoch = ++navigationEpoch;
    beginFeatureGate('matrice', requestEpoch);
    startTransition('Matrice');
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    window.__cidRequestedProgrammeDate = requestedDate;
    window.__cidActiveProgrammeDate = requestedDate;
    if (typeof window.activateMatriceView === 'function') {
      window.activateMatriceView({
        updateHistory,
        programmeDate: requestedDate
      });
      setBottomNavActiveTab('categories');
      finishTransition();
      return;
    }
    get('plantMatriceBtn')?.click();
    finishTransition();
  };

  const showCalculatorView = ({ updateHistory = true } = {}) => {
    const requestEpoch = ++navigationEpoch;
    beginFeatureGate('calculatrice-matrice', requestEpoch);
    startTransition('Déchiffrement MT');
    window.cidShowDedicatedView?.({
      id: 'calculator',
      title: 'Déchiffrement MT',
      onBack: () => window.showCategoriesView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = true;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    markActive('catégories');
    document.body.classList.remove('accueil-active', 'categories-active', 'rejected-active', 'matrice-active', 'archive-active', 'tableaux-active');
    document.body.classList.add('calculator-active');
    window.__currentCategory = 'calculator';
    const categoriesView = get('categoriesView');
    const panel = get('matrixCalculatorPanel');
    if (categoriesView) {
      categoriesView.hidden = true;
      categoriesView.style.display = 'none';
    }
    get('matrixCalcBtn')?.click();
    // A dedicated view can keep the scroll position of its previous visit on
    // mobile Safari. Always open Déchiffrement MT at the beginning of the page.
    if (panel) {
      panel.scrollTop = 0;
      panel.scrollLeft = 0;
      panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    }
    window.scrollTo(0, 0);
    rememberRoute('calculator');
    if (updateHistory) pushViewState('calculator');
    setTimeout(() => {
      if (panel && panel.style.display !== 'block') {
        showCategoriesView({ updateHistory: false });
      }
    }, 0);
    finishTransition();
  };

  const showRejectedView = ({ updateHistory = true, date = '', preview = null } = {}) => {
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
      ? String(date).slice(0, 10)
      : '';
    /*
     * Anticipé preview: the server payload already validated for that future
     * date is rendered through the exact same renderer as the daily
     * publication, in an isolated session (no route memory, no cache write).
     */
    const previewSession = preview && requestedDate && preview.payload
      && typeof preview.payload === 'object'
      ? {
        date: requestedDate,
        payload: preview.payload,
        onBack: typeof preview.onBack === 'function' ? preview.onBack : null
      }
      : null;
    if (previewSession) updateHistory = false;
    const requestEpoch = ++navigationEpoch;
    beginFeatureGate('boules-rejetees', requestEpoch);
    startTransition('Numéros rejetés');
    window.cidShowDedicatedView?.({
      id: 'rejected',
      title: 'Numéros rejetés',
      onBack: () => (previewSession?.onBack
        ? previewSession.onBack()
        : window.showCategoriesView?.())
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    markActive('numéros rejetés');
    document.body.classList.remove('categories-active', 'accueil-active', 'calculator-active', 'rejected-active', 'matrice-active', 'tableaux-active', 'anticipation-active');
    document.body.classList.add('rejected-active');
    window.__cidRequestedProgrammeDate = requestedDate;
    window.__cidActiveProgrammeDate = requestedDate;
    window.__currentCategory = 'boules rejetees';
    window.rejectedController?.enter?.();
    window.rejectedController?.setPreview?.(previewSession);
    if (previewSession) setBottomNavActiveTab('anticipe');
    const results = get('results');
    if (results) {
      results.style.display = '';
      results.removeAttribute('aria-hidden');
    }
    const inlineButton = get('showRejectedInlineButton');
    if (inlineButton && typeof inlineButton.click === 'function') {
      window.__cidRejectedInlineEpoch = requestEpoch;
      /*
       * The inline route owns a local rejected host. Keep the prepared home
       * feed in the DOM so returning to Accueil restores the same measured
       * cards instead of rebuilding the whole scroll surface.
       */
      if (results) {
        const feed = results.querySelector('#cid-home-feed');
        if (feed) {
          feed.hidden = true;
          feed.setAttribute('aria-hidden', 'true');
          feed.style.display = 'none';
        }
        results.querySelector('#rejectedInlineMain')?.remove();
      }
      inlineButton.click();
    } else {
      if (results) {
        const message = results.querySelector('#rejectedInlineMain')
          || document.createElement('p');
        message.textContent = 'Aucune donnée disponible.';
        message.style.cssText = 'padding:20px;text-align:center;color:#666';
        if (!message.isConnected) results.appendChild(message);
      }
    }
    if (!previewSession) rememberRoute('rejetes');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'rejetes');
      if (requestedDate) url.searchParams.set('date', requestedDate);
      else url.searchParams.delete('date');
      history.pushState({
        view: 'rejetes',
        date: requestedDate || null
      }, '', url.toString());
    }
    finishTransition();
  };

  const showSocialPanel = () => {
    showCategoriesView({ updateHistory: false });
    const panel = get('categoriesSocialPanel');
    if (panel) {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        window.cidRenderSocialLinks?.(panel);
        // The categories host is itself a fixed scroll surface. Scrolling the
        // panel into the document viewport can move the global shell on iOS.
        const surface = panel.closest('#categoriesView');
        const top = Math.max(0, panel.offsetTop - 16);
        surface?.scrollTo?.({ top, left: 0, behavior: 'smooth' });
      }
    }
  };

  const showOffersView = ({ updateHistory = true } = {}) => {
    showCategoriesView({ updateHistory });
    const grid = get('categoriesView')?.querySelector('.categories-grid');
    const panel = get('categoriesOffersPanel');
    const social = get('categoriesSocialPanel');
    if (grid) {
      grid.hidden = true;
      grid.setAttribute('aria-hidden', 'true');
    }
    if (social) social.hidden = true;
    if (panel) {
      panel.hidden = false;
      panel.style.display = '';
      panel.removeAttribute('aria-hidden');
      // Offers own this dedicated surface. Do not let the public catalogue
      // mount below the global header or push the Accueil feed downward.
      if (window.cidRenderPublicOffers) {
        window.cidRenderPublicOffers(panel);
      } else {
        window.cidRenderOffersTable?.(panel);
      }
    }
    window.__currentCategory = 'offres';
    rememberRoute('categories-offers');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'categories-offers');
      history.pushState({ view: 'categories-offers' }, '', url.toString());
    }
  };

  const showResultatAideView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Résultats');
    window.cidShowDedicatedView?.({
      id: 'resultat-aide',
      title: 'Résultats',
      onBack: () => window.showCategoriesView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    document.body.classList.remove(
      'accueil-active',
      'categories-active',
      'calculator-active',
      'rejected-active',
      'matrice-active',
      'tableaux-active',
      'anticipation-active'
    );
    const panel = get('resultatAideViewContainer');
    if (panel) {
      panel.hidden = false;
      panel.style.display = '';
      panel.removeAttribute('aria-hidden');
    }
    window.__currentCategory = 'resultat-aide';
    window.cidShowResultatAide?.();
    rememberRoute('categories-resultat-aide');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'categories-resultat-aide');
      history.pushState({ view: 'categories-resultat-aide' }, '', url.toString());
    }
    finishTransition();
  };

  const showGlobalStatisticsView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Statistiques globales');
    window.cidShowDedicatedView?.({
      id: 'global-statistics',
      title: 'Statistiques globales',
      onBack: () => window.showResultatAideView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    document.body.classList.remove(
      'accueil-active',
      'categories-active',
      'calculator-active',
      'rejected-active',
      'matrice-active',
      'tableaux-active',
      'anticipation-active'
    );
    const panel = get('globalStatisticsViewContainer');
    if (panel) {
      panel.hidden = false;
      panel.style.display = '';
      panel.removeAttribute('aria-hidden');
    }
    window.__currentCategory = 'global-statistics';
    window.cidShowGlobalStatistics?.();
    rememberRoute('global-statistics');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'global-statistics');
      history.pushState({ view: 'global-statistics' }, '', url.toString());
    }
    finishTransition();
  };

  const showPublicVirtualView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Cidmap virtuel');
    window.cidShowDedicatedView?.({
      id: 'virtual-assistant',
      title: 'Cidmap virtuel',
      onBack: () => window.showCategoriesView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    document.body.classList.remove(
      'accueil-active',
      'categories-active',
      'calculator-active',
      'rejected-active',
      'matrice-active',
      'tableaux-active',
      'anticipation-active'
    );
    const panel = get('virtualAssistantViewContainer');
    if (panel) {
      panel.hidden = false;
      panel.style.display = '';
      panel.removeAttribute('aria-hidden');
    }
    window.__currentCategory = 'cidmap-virtuel';
    window.cidShowPublicVirtual?.();
    rememberRoute('categories-cidmap-virtuel');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'categories-cidmap-virtuel');
      history.pushState({ view: 'categories-cidmap-virtuel' }, '', url.toString());
    }
    finishTransition();
  };

  const showHistoryView = ({ updateHistory = true } = {}) => {
    ++navigationEpoch;
    startTransition('Historiques');
    window.cidShowDedicatedView?.({
      id: 'history',
      title: 'Historiques',
      onBack: () => window.showCategoriesView?.()
    });
    releaseInitialCategoryLock();
    setBottomNavActiveTab('categories');
    window.__matriceViewOwned = false;
    window.__keepCalculatorView = false;
    window.__returnToCategoriesAfterCalculatorClose = false;
    hideContentViews();
    clearActiveState();
    const panel = get('historyViewContainer');
    if (panel) {
      panel.hidden = false;
      panel.style.display = '';
      panel.removeAttribute('aria-hidden');
    }
    window.__currentCategory = 'history';
    window.cidShowHistory?.();
    rememberRoute('history');
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'history');
      history.pushState({ view: 'history' }, '', url.toString());
    }
    finishTransition();
  };

  const routeOption = (id) => {
    switch (id) {
      case 'submenuMatrice': return showMatriceView();
      case 'submenuCroix': return showCroixView();
      case 'submenuNosReseaux': return showSocialPanel();
      case 'submenuMatrixCalc': return showCalculatorView();
      case 'submenuRejected': return showRejectedView();
      case 'submenuOffers': return showOffersView();
      case 'submenuResultatAide': return showResultatAideView();
      case 'submenuHistory': return showHistoryView();
      case 'submenuVirtual': return showPublicVirtualView();
      default: return undefined;
    }
  };

  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button, a, [role="button"], .category-item, .plant-btn');
    if (!button) return;

    // Tableaux is also a bottom-navigation tab, but its view is owned by its
    // dedicated controller. Claim the navigation event here so legacy
    // listeners cannot leave another bottom button highlighted.
    if (button.closest('.category-bar') && button.id === 'tableauxBtn') {
      event.preventDefault();
      event.stopImmediatePropagation();
      ++navigationEpoch;
      setBottomNavActiveTab('tableaux');
      if (typeof window.showTableauxView === 'function') {
        window.showTableauxView();
      }
      return;
    }

    if (button.closest('.category-bar') && button.id === 'anticipationBtn') {
      event.preventDefault();
      event.stopImmediatePropagation();
      ++navigationEpoch;
      if (typeof window.showAnticipationView === 'function') {
        window.showAnticipationView();
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set('section', 'anticipe');
        window.location.assign(url.toString());
      }
      return;
    }

    const categoryTrigger = button.id === 'categoryCategoriesButton' ||
      button.getAttribute('data-category-trigger') === 'categories';
    if (categoryTrigger) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveTab('categories');
      return;
    }

    if (button.closest('.category-bar') && button.id === 'profileBtn') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setBottomNavActiveTab('compte');
      window.showProfileView?.({ updateHistory: true });
      return;
    }

    if (button.id === 'categoriesHomeButton') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveTab('accueil');
      return;
    }

    if (button.id.startsWith('submenu')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      routeOption(button.id);
      return;
    }

    if (button.id === 'categoryAccueilButton' || normalize(button.textContent) === 'accueil') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveTab('accueil');
    }
  };

  // Native SPA state transition: no navigation, no reload, no async gate.
  const setActiveTab = (nextTab, options = {}) => {
    activeTab = normalize(nextTab) === 'categories' ? 'categories' : 'accueil';
    window.__activeTab = activeTab;
    if (activeTab === 'categories') showCategoriesView(options);
    else showHomeView(options);
  };

  const init = () => {
    if (window.__categoriesViewInitialized) return;
    window.__categoriesViewInitialized = true;
    ensureStyles();
    if (Object.values(BOTTOM_NAV_TABS).includes(window.__activeTab)) {
      activeTab = window.__activeTab;
    }
    setBottomNavActiveTab(activeTab);
    window.setActiveTab = setActiveTab;
    window.setBottomNavActiveTab = setBottomNavActiveTab;
    window.showCategoriesView = showCategoriesView;
    window.showHomeView = showHomeView;
    window.showCroixView = showCroixView;
    window.showRejectedView = showRejectedView;
    window.showOffersView = showOffersView;
    window.showResultatAideView = showResultatAideView;
    window.showGlobalStatisticsView = showGlobalStatisticsView;
    window.showHistoryView = showHistoryView;
    window.showPublicVirtualView = showPublicVirtualView;
    window.showCalculatorView = showCalculatorView;
    // The translated shell can already have Home selected before bootstrap
    // runs. Mount the home view explicitly so a translated label never leaves
    // the main feed empty.
    const querySection = new URLSearchParams(window.location.search)
      .get('section')
      ?.trim()
      .toLowerCase();
    const requestedSection = querySection
      || window.cidRoutePersistence?.resolveInitialRoute?.()?.section;
    if (!requestedSection || requestedSection === 'accueil' || requestedSection === 'home') {
      showHomeView({ updateHistory: false });
    } else if (requestedSection === 'categories' || requestedSection === 'categories-offers') {
      if (requestedSection === 'categories-offers') {
        showOffersView({ updateHistory: false });
      } else {
        showCategoriesView({ updateHistory: false });
      }
    } else if (requestedSection === 'categories-resultat-aide') {
      showResultatAideView({ updateHistory: false });
    } else if (requestedSection === 'global-statistics') {
      showGlobalStatisticsView({ updateHistory: false });
    } else if (requestedSection === 'history') {
      showHistoryView({ updateHistory: false });
    } else if (requestedSection === 'categories-cidmap-virtuel') {
      showPublicVirtualView({ updateHistory: false });
    }
    document.addEventListener('click', onClick, true);
    window.addEventListener('cid:feature-access-changed', () => {
      // An administrator can change an offer while a protected view is
      // already open in another tab. Leave that view as soon as its
      // entitlement disappears instead of leaving old results on screen.
      const featureByView = {
        croix: 'croix',
        matrice: 'matrice',
        calculator: 'calculatrice-matrice',
        'boules rejetees': 'boules-rejetees',
        'numéros rejetés': 'boules-rejetees'
      };
      const featureKey = featureByView[String(window.__currentCategory || '').toLowerCase()];
      if (!featureKey || window.cidFeatureAccess?.has?.(featureKey)) return;
      showCategoriesView({ updateHistory: false });
    });
    window.addEventListener('popstate', (event) => {
      if (event.state?.view === 'categories') {
        event.stopImmediatePropagation();
        showCategoriesView({ updateHistory: false });
      } else if (event.state?.view === 'categories-offers') {
        event.stopImmediatePropagation();
        showOffersView({ updateHistory: false });
      } else if (event.state?.view === 'categories-resultat-aide') {
        event.stopImmediatePropagation();
        showResultatAideView({ updateHistory: false });
      } else if (event.state?.view === 'global-statistics') {
        event.stopImmediatePropagation();
        showGlobalStatisticsView({ updateHistory: false });
      } else if (event.state?.view === 'history') {
        event.stopImmediatePropagation();
        showHistoryView({ updateHistory: false });
      } else if (event.state?.view === 'categories-cidmap-virtuel') {
        event.stopImmediatePropagation();
        showPublicVirtualView({ updateHistory: false });
      } else if (event.state?.view === 'accueil') {
        event.stopImmediatePropagation();
        showHomeView({ updateHistory: false });
      } else if (event.state?.view === 'calculator') {
        event.stopImmediatePropagation();
        showCalculatorView({ updateHistory: false });
      } else if (event.state?.view === 'croix') {
        event.stopImmediatePropagation();
        showCroixView({
          updateHistory: false,
          date: event.state?.date || new URLSearchParams(window.location.search).get('date') || ''
        });
      } else if (event.state?.view === 'matrice') {
        event.stopImmediatePropagation();
        showMatriceView({ updateHistory: false });
      } else if (event.state?.view === 'rejetes') {
        event.stopImmediatePropagation();
        showRejectedView({ updateHistory: false });
      } else if (event.state?.view === 'anticipe') {
        event.stopImmediatePropagation();
        window.showAnticipationView?.({ updateHistory: false });
      } else if (!new URLSearchParams(window.location.search).get('section')) {
        // The first document entry has no section query. Returning to it with
        // the browser back button is a real Accueil transition, not a reason
        // to keep the last remembered deep route mounted.
        event.stopImmediatePropagation();
        showHomeView({ updateHistory: false });
      }
    });

  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
