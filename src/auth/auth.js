/*
 * Compatibility facade for the API-driven account view.
 *
 * Authentication is implemented by account-service.js. This classic script
 * only keeps the small global contract used by older SPA modules; it owns no
 * credentials, session, profile or subscription storage.
 */
(function initCidAuthFacade() {
  'use strict';

  let currentProfile = null;
  let unreadMessagesCount = 0;

  function service() {
    return window.cidAccountServiceReady || Promise.resolve(window.cidAccountService || null);
  }

  function current() {
    return currentProfile || window.cidAccountService?.getCachedUserProfile?.() || null;
  }

  function stats() {
    const profile = current();
    return {
      stars: Number(profile?.stats?.stars) || Number(window.cidUserStats?.get?.()?.etoilesGagnees) || 0,
      sharedLinks: Number(profile?.stats?.shareCount) || Number(window.cidUserStats?.get?.()?.nombrePartages) || 0
    };
  }

  function serializeProfile(profile = current()) {
    if (!profile) return null;
    const accountStats = stats();
    return {
      id: profile.id || profile.uid || '',
      uid: profile.uid || profile.id || '',
      cid: profile.cid || '',
      name: profile?.name || 'Membre Cidmap',
      email: profile?.email || '',
      country: profile?.country || '',
      stars: accountStats.stars,
      sharedLinks: accountStats.sharedLinks
    };
  }

  function referralLink(cid) {
    const target = new URL(window.location.href);
    target.protocol = 'https:';
    target.hostname = 'cidmap.com';
    target.port = '';
    target.search = '';
    if (cid) target.searchParams.set('ref', String(cid));
    return target.toString();
  }

  window.cidAuth = Object.freeze({
    getCurrentProfile: current,
    getStats: stats,
    referralLink,
    serializeProfile,
    signInWithPassword: (email, password) => service().then((api) => (
      api?.loginUser?.({ email, password })
    )),
    signUpWithPassword: (email, password, name) => service().then((api) => (
      api?.registerUser?.({ email, password, name })
    )),
    signInWithGoogle: () => service().then((api) => api?.loginWithGoogle?.()),
    trackVisit: () => ({ accepted: false, reason: 'server-account-required' })
  });

  window.cidSetUnreadMessagesCount = (count) => {
    unreadMessagesCount = Math.max(0, Number(count) || 0);
    window.unreadMessagesCount = unreadMessagesCount;
  };
  window.cidIncrementUnreadMessagesCount = (amount = 1) => {
    window.cidSetUnreadMessagesCount(unreadMessagesCount + Math.max(1, Number(amount) || 1));
  };
  window.cidSetAccountTab = (tab) => {
    window.dispatchEvent(new CustomEvent('cid:account-tab', { detail: { tab } }));
  };
  window.cidHandleAccountExit = () => {};
  window.initCidAuthView = () => {};

  window.addEventListener('cid:auth-sync', (event) => {
    currentProfile = event.detail || null;
  });

  service().then((api) => {
    const profile = api?.getCachedUserProfile?.();
    if (profile) currentProfile = profile;
  }).catch(() => {});
})();
