import { mountAccountView } from './account-view.js';
import {
  getCachedUserProfile,
  getCurrentAuthState,
  fetchUserProfile
} from './account-service.js';

const root = document.getElementById('account-page-root');
if (root) {
  const view = mountAccountView(root, {
    user: getCachedUserProfile(),
    session: null
  });

  getCurrentAuthState()
    .then(async ({ user, session }) => {
      if (!user?.id) return;
      const profile = await fetchUserProfile();
      if (profile) {
        view.destroy();
        mountAccountView(root, { user: profile, session });
      }
    })
    .catch((error) => {
      console.warn('Session Compte indisponible', error?.message || error);
    });
}
