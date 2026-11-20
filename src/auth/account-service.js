/*
 * API boundary for the account area.
 *
 * The account UI never reads browser storage and never fabricates a user.
 * Supabase Auth owns the remote session; profile and account aggregates are
 * fetched from Supabase/Postgres (the subscription-access Edge Function is
 * the server boundary for private subscription data).
 */
import { supabaseClient } from '../services/supabaseClient.js';

let cachedProfile = null;
let authRevision = 0;
let lastPublishedAuthUserId = '';

const clean = (value) => String(value ?? '').trim();

function serviceError(message, cause) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  return error;
}

function normalizeHistory(access) {
  const rows = (value) => Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object')
    : [];
  const grants = rows(access?.history?.grants);
  const spends = rows(access?.history?.spends);
  const tokenGrants = rows(access?.history?.tokenGrants);
  const tokenSpends = rows(access?.history?.tokenSpends);
  const featureUnlockSpends = Array.isArray(access?.history?.featureUnlockSpends)
    ? rows(access.history.featureUnlockSpends)
    : [];
  const requests = rows(access?.history?.requests);
  const featureUnlocks = rows(access?.featureUnlocks);
  const activeSubscription = access?.subscription || null;
  const expiryForFeature = (featureKey) => (
    featureUnlocks.find((unlock) => (
      String(unlock?.feature_key || unlock?.featureKey || '') === String(featureKey || '')
    ))?.expires_at || null
  );
  return [
    ...grants.map((item) => ({
      id: item.id || `grant-${item.created_at}`,
      type: 'credit',
      currency: 'stars',
      amount: Math.max(0, Number(item.amount) || 0),
      label: item.note || 'Étoiles attribuées',
      paymentMethod: item.payment_method || '',
      createdAt: item.created_at || null
    })),
    ...spends.map((item) => ({
      id: item.id || `spend-${item.created_at}`,
      type: 'debit',
      currency: 'stars',
      amount: Math.max(0, Number(item.amount) || 0),
      label: item.plan_name || 'Accès débloqué',
      planSlug: item.plan_slug || '',
      expiresAt: activeSubscription?.expires_at || null,
      createdAt: item.created_at || null
    })),
    ...tokenGrants.map((item) => ({
      id: item.id || `token-grant-${item.created_at}`,
      type: 'credit',
      currency: 'tokens',
      amount: Math.max(0, Number(item.amount) || 0),
      label: item.note || 'Jetons attribués',
      paymentMethod: item.payment_method || '',
      createdAt: item.created_at || null
    })),
    ...tokenSpends.map((item) => ({
      id: item.id || `token-spend-${item.created_at}`,
      type: 'debit',
      currency: 'tokens',
      amount: Math.max(0, Number(item.amount) || 0),
      label: item.plan_name || 'Accès débloqué avec des jetons',
      planSlug: item.plan_slug || '',
      expiresAt: activeSubscription?.expires_at || null,
      createdAt: item.created_at || null
    })),
    ...featureUnlockSpends.map((item) => ({
      id: item.id || `feature-unlock-${item.feature_key}-${item.created_at}`,
      type: 'debit',
      currency: item.currency || 'tokens',
      amount: Math.max(0, Number(item.amount) || 0),
      label: item.feature_name || item.feature_key || 'Schéma débloqué',
      featureKey: item.feature_key || '',
      expiresAt: expiryForFeature(item.feature_key),
      createdAt: item.created_at || null
    })),
    ...requests.map((item) => ({
      id: item.id || `request-${item.created_at}`,
      type: 'purchase',
      currency: 'stars',
      amount: Math.max(0, Number(item.stars_requested) || 0),
      label: `Achat de ${Number(item.stars_requested) || 0} étoile(s) · ${item.status || 'en attente'}`,
      status: item.status || 'pending',
      countryCode: item.country_code || '',
      currencyCode: item.currency_code || '',
      unitPrice: Number(item.unit_price) || 0,
      totalPrice: Number(item.total_price) || 0,
      createdAt: item.created_at || null
    }))
  ].sort((left, right) => (
    Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')
  ));
}

function normalizeProfile(user, profileRow, access, roleRow = null) {
  const metadata = user?.user_metadata || {};
  const name = clean(
    profileRow?.full_name
      || metadata.full_name
      || metadata.name
      || metadata.preferred_username
  ) || 'Membre Cidmap';
  const email = clean(user?.email || profileRow?.email);
  const role = clean(roleRow?.role || profileRow?.role);

  const subscription = access?.subscription
    ? {
      ...access.subscription,
      planName: access.activePlan?.display_name
        || access.activePlan?.name
        || access.subscription.plan_name
        || access.subscription.plan_slug
        || 'Forfait actif',
      features: Array.isArray(access.activePlan?.features)
        ? access.activePlan.features
        : []
    }
    : null;

  return {
    id: user?.id || '',
    uid: user?.id || '',
    // The database UUID is the identity source. The CID is only a stable
    // display/reference alias for legacy sharing links.
    cid: clean(profileRow?.cid || metadata.cid)
      || `CID-${String(user?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    name,
    email,
    country: clean(profileRow?.country),
    role: role || undefined,
    is_admin: profileRow?.is_admin === true || role === 'admin',
    createdAt: user?.created_at || profileRow?.created_at || null,
    provider: 'supabase',
    stats: {
      stars: Math.max(0, Number(access?.stars) || 0),
      tokens: Math.max(0, Number(access?.tokens) || 0),
      shareCount: Math.max(0, Number(access?.shareCount) || 0)
    },
    subscription,
    localeCode: access?.localization?.selectedLocale
      || access?.localization?.userLocaleCode
      || null,
    activePlan: access?.activePlan || null,
    featureUnlocks: Array.isArray(access?.featureUnlocks)
      ? access.featureUnlocks.filter((item) => item && typeof item === 'object')
      : [],
    history: normalizeHistory(access)
  };
}

function immediateProfile(user) {
  return normalizeProfile(user, null, {});
}

function publishAuthSync(profile) {
  const userId = String(profile?.id || profile?.uid || '').trim();
  /*
   * A tab can move directly from the administrator account to a normal
   * account without a full reload.  Reset the privileged display hint for
   * every identity transition, not only for SIGNED_OUT.  The Tableaux view
   * will set it back only after it has verified the new user's role.
   */
  if (String(window.cidAuthCurrentUserId || '').trim() !== userId) {
    window.cidIsAdmin = false;
  }
  lastPublishedAuthUserId = userId;
  // This flag is consumed by the Tableaux display boundary. It must never
  // survive a session change: a former administrator and the next visitor
  // can use the same SPA tab.
  window.cidAuthCurrentUserId = userId;
  if (!userId) window.cidIsAdmin = false;
  window.dispatchEvent(new CustomEvent('cid:auth-sync', {
    detail: profile || null
  }));
}

export function getImmediateUserProfile(user) {
  return immediateProfile(user);
}

export async function getCurrentAuthState() {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw serviceError('Le service d’authentification est indisponible.');
  const { data, error } = await client.auth.getSession();
  if (error) throw serviceError('Impossible de récupérer la session.', error);
  return {
    user: data?.session?.user || null,
    session: data?.session || null
  };
}

function hydrateProfileInBackground(user, revision) {
  // The profile/access tables are enrichment data. They must never delay the
  // first authenticated render. Ignore a late response after logout or after
  // another account has signed in.
  fetchUserProfile()
    .then((profile) => {
      if (!profile || revision !== authRevision || cachedProfile?.id !== user?.id) return;
      window.dispatchEvent(new CustomEvent('cid:auth-sync', { detail: profile }));
    })
    .catch((error) => {
      console.warn('Hydratation du profil en arrière-plan indisponible', error?.message || error);
    });
}

async function getAuthenticatedUser() {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  const auth = client?.auth;
  if (!client || !auth) {
    throw serviceError('Le service d’authentification est indisponible.');
  }
  const { data, error } = await auth.getUser();
  // Supabase reports an absent session as a 401/AuthSessionMissingError.
  // That is the expected non-connected state, not a failed database request.
  if (error && !(
    Number(error.status) === 401
    || error.name === 'AuthSessionMissingError'
    || error.code === 'session_not_found'
  )) {
    throw serviceError('Impossible de vérifier la session.', error);
  }
  return { client, user: data?.user || null };
}

async function fetchAccountAccess(client) {
  const functions = client?.functions;
  if (!functions?.invoke) return {};
  const { data, error } = await functions.invoke('subscription-access', {
    body: {}
  });
  if (error) throw serviceError('Impossible de charger les données du compte.', error);
  if (data && data.ok === false) {
    throw serviceError(data.error || 'Impossible de charger les données du compte.');
  }
  return data?.access || {};
}

/**
 * Fetch the current authenticated profile and all account aggregates.
 * Resolves with null when no remote session exists.
 */
export async function fetchUserProfile() {
  const { client, user } = await getAuthenticatedUser();
  if (!user?.id) {
    cachedProfile = null;
    return null;
  }

  let profileQuery = await client
    .from('profiles')
    .select('id,full_name,country,created_at')
    .eq('id', user.id)
    .maybeSingle();
  // Older installations grant access to the public profile's core columns
  // only. Keep the server contract compatible while the migration rolls out.
  if (profileQuery.error) {
    profileQuery = await client
      .from('profiles')
      .select('id,full_name')
      .eq('id', user.id)
      .maybeSingle();
  }
  if (profileQuery.error) {
    throw serviceError('Impossible de charger votre profil.', profileQuery.error);
  }

  // The role is maintained separately from the public profile on the
  // recommended schema. A missing/older user_roles table is tolerated: the
  // protected admin service remains the authoritative fallback.
  let roleRow = null;
  try {
    const roleQuery = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleQuery.error) roleRow = roleQuery.data || null;
  } catch (_) {
    roleRow = null;
  }

  const access = await fetchAccountAccess(client);
  cachedProfile = normalizeProfile(user, profileQuery.data, access, roleRow);
  return cachedProfile;
}

/**
 * Sign in remotely and return a renderable profile immediately. Database
 * profile/access enrichment continues independently in the background.
 */
export async function loginUser(credentials = {}) {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw serviceError('Le service d’authentification est indisponible.');
  const email = clean(credentials.email).toLowerCase();
  const password = String(credentials.password || '');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data?.user) throw serviceError('La connexion n’a pas retourné de compte.');
  const revision = ++authRevision;
  const profile = immediateProfile(data.user);
  cachedProfile = profile;
  publishAuthSync(profile);
  hydrateProfileInBackground(data.user, revision);
  return profile;
}

/**
 * Account creation is kept beside login so the UI has one remote boundary.
 */
export async function registerUser(credentials = {}) {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw serviceError('Le service d’authentification est indisponible.');
  const email = clean(credentials.email).toLowerCase();
  const password = String(credentials.password || '');
  const name = clean(credentials.name);
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } }
  });
  if (error) throw error;
  if (!data?.user || !data?.session) {
    throw serviceError('Vérifiez votre e-mail pour confirmer votre compte.');
  }
  const revision = ++authRevision;
  const profile = immediateProfile(data.user);
  cachedProfile = profile;
  publishAuthSync(profile);
  hydrateProfileInBackground(data.user, revision);
  return profile;
}

export async function logoutUser() {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw serviceError('Le service d’authentification est indisponible.');
  const { error } = await client.auth.signOut();
  if (error) throw error;
  authRevision += 1;
  cachedProfile = null;
  publishAuthSync(null);
  return null;
}

export async function loginWithGoogle() {
  const client = supabaseClient || (await window.cidSupabaseReady)?.client;
  if (!client?.auth) throw serviceError('Le service d’authentification est indisponible.');
  try {
    sessionStorage.setItem('cid-auth-oauth-pending', '1');
  } catch (_) {}
  const redirectUrl = new URL(window.location.href);
  redirectUrl.search = '';
  redirectUrl.searchParams.set('account', '1');
  redirectUrl.hash = '';
  if (redirectUrl.pathname.endsWith('/src/auth/auth.html')) redirectUrl.pathname = '/';
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl.toString(),
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error) {
    try { sessionStorage.removeItem('cid-auth-oauth-pending'); } catch (_) {}
    throw error;
  }
  return data || null;
}

export async function updateUserProfile({ name, country } = {}) {
  const { client, user } = await getAuthenticatedUser();
  if (!user?.id) throw serviceError('Connectez-vous pour modifier votre profil.');
  const fullName = clean(name);
  if (!fullName) throw serviceError('Indiquez un nom affiché.');
  const { error } = await client
    .from('profiles')
    .update({ full_name: fullName, country: clean(country) })
    .eq('id', user.id);
  if (error) throw serviceError('Impossible d’enregistrer votre profil.', error);
  return fetchUserProfile();
}

export function getCachedUserProfile() {
  return cachedProfile;
}

export const accountService = Object.freeze({
  fetchUserProfile,
  loginUser,
  registerUser,
  logoutUser,
  loginWithGoogle,
  updateUserProfile,
  getCachedUserProfile
});

export const authService = accountService;
window.cidAccountService = accountService;
window.cidAuthService = accountService;
window.cidAccountServiceReady = Promise.resolve(accountService);

/*
 * Keep the rest of the SPA synchronized even when Supabase changes the
 * session outside the account form (OAuth callback, another tab, expiry or
 * an external sign-out). The explicit login/logout methods above already
 * publish their state, so duplicate SIGNED_IN notifications for the same
 * user are ignored.
 */
if (supabaseClient?.auth?.onAuthStateChange) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    if (event === 'SIGNED_OUT' || !user?.id) {
      if (lastPublishedAuthUserId) {
        authRevision += 1;
        cachedProfile = null;
        publishAuthSync(null);
      } else {
        window.cidAuthCurrentUserId = '';
        window.cidIsAdmin = false;
      }
      return;
    }
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      && String(user.id) !== lastPublishedAuthUserId) {
      authRevision += 1;
      const profile = immediateProfile(user);
      cachedProfile = profile;
      publishAuthSync(profile);
      hydrateProfileInBackground(user, authRevision);
    }
  });
}
