/*
 * One authentication gate for all social mutations.
 *
 * Reading the public feed never calls this helper. Likes, replies and new
 * comments use it before touching the UI or the Supabase repository, then
 * open the exact same native Account view as the bottom navigation.
 */
(function initCidSocialAuthGate() {
  'use strict';

  let pendingOpen = null;

  async function currentUser() {
    try {
      const bridge = await window.cidSupabaseReady;
      return await bridge?.getUser?.() || null;
    } catch (_) {
      return null;
    }
  }

  function openAccount() {
    if (pendingOpen) return pendingOpen;
    const open = window.showProfileView || window.openInlineAuthPanel;
    if (typeof open !== 'function') return Promise.resolve(false);
    pendingOpen = Promise.resolve()
      .then(() => open())
      .then(() => true)
      .catch((error) => {
        console.warn('Ouverture du compte impossible', error);
        return false;
      })
      .finally(() => { pendingOpen = null; });
    return pendingOpen;
  }

  async function requireAccount() {
    const user = await currentUser();
    if (user?.id) return user;
    await openAccount();
    return null;
  }

  window.cidSocialAuthGate = Object.freeze({
    currentUser,
    openAccount,
    requireAccount
  });
})();
