/*
 * Account route adapter.
 *
 * The global shell owns the viewport and navigation. AccountView owns the
 * account state and renders inside this dedicated host without touching the
 * rest of the SPA.
 */
import { mountAccountView as createNativeAccountView } from './account-view.js?share-i18n-v1';
import {
  getCurrentAuthState,
  getCachedUserProfile,
  getImmediateUserProfile,
  fetchUserProfile
} from './account-service.js';

const HOME_VIEW_IDS = [
  'topBanner',
  'redCross',
  'redCrossClone',
  'countryButtons',
  'categoriesView',
  'tableauxViewContainer',
  'croixViewContainer',
  'matrixActions',
  'results',
  'matrixPageTitle',
  'currentDateTime',
  'nextAvailableTime',
  'nextDay',
  'drawNumber'
];

let accountRoot = null;
let homeDisplayState = null;

const get = (id) => document.getElementById(id);
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('fr-FR');

function hideHomeView() {
  if (!homeDisplayState) {
    homeDisplayState = new Map();
    HOME_VIEW_IDS.forEach((id) => {
      const element = get(id);
      if (!element) return;
      homeDisplayState.set(id, {
        display: element.style.display,
        hidden: element.hidden,
        ariaHidden: element.getAttribute('aria-hidden')
      });
    });
  }
  HOME_VIEW_IDS.forEach((id) => {
    const element = get(id);
    if (!element) return;
    element.style.display = 'none';
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
  });
}

function restoreHomeView() {
  if (!homeDisplayState) return;
  homeDisplayState.forEach((state, id) => {
    const element = get(id);
    if (!element) return;
    element.style.display = state.display;
    element.hidden = state.hidden;
    if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', state.ariaHidden);
  });
  homeDisplayState = null;
}

function mountAccountView(host, props = {}) {
  if (accountRoot) accountRoot.destroy();
  accountRoot = createNativeAccountView(host, props);
  return accountRoot;
}

function renderAuthenticatedAccount(host, user, session) {
  if (!host || host.hidden || !user?.id) return false;
  unmountAccountView();
  accountRoot = mountAccountView(host, { user, session });
  return true;
}

async function hydrateCurrentAccount(host) {
  if (!host || host.hidden) return;
  try {
    const { user, session } = await getCurrentAuthState();
    if (!user?.id || host.hidden) return;
    // The Supabase session is the source of truth for authentication. Render
    // the account from it immediately instead of waiting for the optional
    // profile/access aggregates. If one of those enrichment requests is
    // unavailable (for example while an Edge Function is waking up), the
    // visitor must still see their account rather than the sign-in form.
    renderAuthenticatedAccount(host, getImmediateUserProfile(user), session);
    try {
      const profile = await fetchUserProfile();
      if (!profile || host.hidden) return;
      renderAuthenticatedAccount(host, profile, session);
    } catch (error) {
      console.warn('Données complémentaires du compte indisponibles', error?.message || error);
    }
    const openBalanceHistory = Boolean(window.__cidBalancePanelRequested);
    window.__cidBalancePanelRequested = false;
    if (openBalanceHistory) {
      window.setTimeout(() => window.cidSetAccountTab?.('history'), 0);
    }
  } catch (error) {
    // The login form is already usable. A failed session read must not blank
    // or replace it with a loader.
    console.warn('Session Compte indisponible', error?.message || error);
  }
}

async function hydrateOAuthAccount(host) {
  let pending = new URLSearchParams(window.location.search).get('account') === '1';
  try {
    pending = pending || sessionStorage.getItem('cid-auth-oauth-pending') === '1';
    sessionStorage.removeItem('cid-auth-oauth-pending');
  } catch (_) {}
  if (!pending || !host || host.hidden) return;

  try {
    const { user, session } = await getCurrentAuthState();
    if (!user?.id || host.hidden) return;
    // The auth session is already the result of the user's Google click.
    // Render a usable dashboard from it immediately; profile/access enrichment
    // must not be able to put the form back or block this route.
    renderAuthenticatedAccount(host, getImmediateUserProfile(user), session);
  } catch (error) {
    console.warn('Retour OAuth non hydraté', error?.message || error);
  }
}

function unmountAccountView() {
  if (!accountRoot) return;
  accountRoot.destroy?.();
  accountRoot = null;
}

function syncAccountRoute({ replace = false } = {}) {
  const currentUrl = new URL(window.location.href);
  const currentSection = window.cidRoutePersistence?.normalizeSection?.(
    currentUrl.searchParams.get('section')
  );
  if (currentSection === 'profil') {
    window.cidRoutePersistence?.remember?.('profil');
    return;
  }

  currentUrl.searchParams.set('section', 'profil');
  currentUrl.searchParams.delete('account');
  const method = replace ? 'replaceState' : 'pushState';
  window.history?.[method]?.(
    { ...(window.history.state || {}), view: 'profil' },
    '',
    currentUrl.toString()
  );
  window.cidRoutePersistence?.remember?.('profil');
}

function showProfileView({ updateHistory = true } = {}) {
  const host = get('profileViewContainer');
  if (!host) return Promise.resolve(false);

  // Compte is a full native route, never a modal. Release any stale lock
  // before mounting it so its own scroll surface is immediately usable.
  window.cidResetScrollLock?.({ closeModals: true, resetSurfaces: true });
  if (updateHistory) syncAccountRoute();
  window.cidNotifications?.close?.({ fromHistory: true });
  window.cidCloseBalancePanel?.({ fromHistory: true });
  window.hideAnticipationView?.();
  window.cidRoutePersistence?.remember?.('profil');
  window.cidShowDedicatedView?.({
    id: 'profile',
    title: 'Compte',
    onBack: () => {
      leaveProfileView();
      window.showHomeView?.();
    }
  });
  document.body.classList.remove('cid-account-chat-active');
  document.body.classList.remove(
    'accueil-active',
    'categories-active',
    'calculator-active',
    'rejected-active',
    'matrice-active',
    'archive-active',
    'tableaux-active',
    'croix-active',
    'cid-facebook-feed-active'
  );
  // The feed controller uses this semantic route value to decide whether it
  // should mount the home publication. Compte must never be treated as home.
  window.__currentCategory = 'compte';
  window.rejectedController?.leave?.();
  window.hideMatriceView?.();
  window.hideTableauxView?.();
  window.scrollTo(0, 0);
  host.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  if (typeof window.setBottomNavActiveTab === 'function') {
    window.setBottomNavActiveTab('compte');
  } else {
    // Safe fallback for the short interval before categories-view initializes.
    // It still enforces the single-active-button invariant.
    document.querySelectorAll('.category-bar .category-item').forEach((item) => {
      const isActive = item.id === 'profileBtn';
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-pressed', String(isActive));
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    window.__activeTab = 'compte';
  }
  hideHomeView();
  host.hidden = false;
  host.style.display = 'block';
  host.setAttribute('aria-hidden', 'false');
  const cachedProfile = getCachedUserProfile?.()
    || (window.__cidInitialSessionUser?.id
      ? getImmediateUserProfile(window.__cidInitialSessionUser)
      : null);
  mountAccountView(host, {
    user: cachedProfile,
    session: cachedProfile ? { user: cachedProfile } : null
  });
  // The cached profile is intentionally only a fast first paint. Always
  // hydrate from Supabase so a newly granted balance cannot remain displayed
  // as zero after login.
  hydrateCurrentAccount(host);
  window.__cidInitialSessionUser = null;
  return Promise.resolve(true);
}

function leaveProfileView() {
  // Release the previous route before another section is shown.
  // Hiding the host alone leaves the AccountView tree mounted.
  unmountAccountView();
  window.cidResetScrollLock?.({ resetSurfaces: true });
  const host = get('profileViewContainer');
  if (!host || host.hidden) return;
  document.body.classList.remove('cid-account-chat-active');
  host.hidden = true;
  host.style.display = 'none';
  host.setAttribute('aria-hidden', 'true');
  if (document.body.dataset.cidDedicatedView === 'profile') window.cidHideDedicatedView?.();
  const profileButton = get('profileBtn');
  if (profileButton) {
    profileButton.classList.remove('active');
    profileButton.setAttribute('aria-pressed', 'false');
    profileButton.removeAttribute('aria-current');
  }
  restoreHomeView();
}

function continueNavigation(button) {
  const id = button.id;
  const label = normalize(button.textContent);
  if (id === 'categoryAccueilButton' || label === 'accueil') {
    if (typeof window.setActiveTab === 'function') window.setActiveTab('accueil');
    else button.click();
    return;
  }
  if (id === 'categoryCategoriesButton' || label === 'catégories') {
    if (typeof window.setActiveTab === 'function') window.setActiveTab('categories');
    else button.click();
    return;
  }
  if (id === 'tableauxBtn' && typeof window.showTableauxView === 'function') {
    window.showTableauxView();
    return;
  }
  button.click();
}

function handleClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const profileButton = target.closest('#profileBtn');
  if (profileButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showProfileView();
    return;
  }
  const host = get('profileViewContainer');
  if (host && !host.hidden) {
    const categoryButton = target.closest('.category-item, .plant-btn');
    const label = normalize(categoryButton?.textContent);
    if (categoryButton && label !== 'profil' && label !== 'compte') {
      event.preventDefault();
      event.stopImmediatePropagation();
      leaveProfileView();
      continueNavigation(categoryButton);
    }
  }
}

function init() {
  if (window.__profileNativeInitialized) return;
  window.__profileNativeInitialized = true;
  document.addEventListener('click', handleClick, true);
  if (new URLSearchParams(window.location.search).get('account') === '1') {
    // Keep the route intent available to bootstrap even though the callback
    // query is removed from the visible URL below.
    window.__cidAccountRouteRequested = true;
    // OAuth returns to the root document. Reopen the same account surface so
    // the visitor sees the hydrated profile immediately after Google login.
    window.setTimeout(() => {
      const shown = showProfileView({ updateHistory: false });
      if (shown) hydrateOAuthAccount(get('profileViewContainer'));
      const url = new URL(window.location.href);
      url.searchParams.delete('account');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }, 0);
  }
}

window.showProfileView = showProfileView;
window.openInlineAuthPanel = showProfileView;
window.cidOpenBalancePanel = (options = {}) => {
  if (typeof window.cidShowBalancePanel === 'function') {
    return window.cidShowBalancePanel(options);
  }
  window.__cidBalancePanelRequested = true;
  const result = showProfileView();
  window.setTimeout(() => {
    window.cidSetAccountTab?.('history');
  }, 0);
  return result;
};
window.cidUnmountAccountView = unmountAccountView;
window.cidLeaveProfileView = leaveProfileView;
window.cidSetAccountTab = (tab) => {
  window.dispatchEvent(new CustomEvent('cid:account-tab', { detail: { tab } }));
};
window.cidHandleAccountExit = () => {};

function handleAccountRouteChange() {
  const requested = window.cidRoutePersistence?.readUrl?.()?.section || null;
  const accountIsVisible = document.body.dataset.cidDedicatedView === 'profile'
    || !get('profileViewContainer')?.hidden;

  if (requested === 'profil') {
    showProfileView({ updateHistory: false });
    return;
  }
  if (!accountIsVisible) return;

  leaveProfileView();
  switch (requested) {
    case 'categories':
      window.showCategoriesView?.({ updateHistory: false });
      break;
    case 'tableaux':
      window.showTableauxView?.({ updateHistory: false });
      break;
    case 'anticipe':
      window.showAnticipationView?.({ updateHistory: false });
      break;
    case 'accueil':
    default:
      window.showHomeView?.({ updateHistory: false });
      break;
  }
}

window.addEventListener('popstate', handleAccountRouteChange);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
